import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { SpmtRtcRelayHubV1, SpmtRtcRelaySocketAdapterV1, verifySpmtRtcCanaryTicketV1 } from './dist/index.js';

const WS_GUID='258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const PATH='/v1/hearmeout/rtc';

export function createSpmtRtcGateway(options={}){
  const secret=String(options.secret??''); if(secret.length<32) throw new Error('SPMT RTC gateway requires a 32+ character canary secret');
  const tenantId=clean(options.tenantId,'tenantId'), roomId=clean(options.roomId,'roomId');
  const host=String(options.host??'127.0.0.1'), port=Number(options.port??8094);
  if(!Number.isInteger(port)||port<0||port>65535) throw new Error('SPMT RTC gateway port is invalid');
  const hub=new SpmtRtcRelayHubV1({maxParticipants:32,maxFrameBytes:65536,maxFramesPerSecond:100,idleRoomMs:60000});
  const adapter=new SpmtRtcRelaySocketAdapterV1(hub,{authorize:({authorization})=>authorization==='Bearer spmt-rtc-canary-authorized'});
  const server=createServer((req,res)=>{
    const url=new URL(req.url??'/','http://rtc.local');
    if(req.method==='GET'&&url.pathname==='/health/live') return json(res,200,{live:true,service:'spmt-rtc-gateway',mode:'canary-hmac'});
    if(req.method==='GET'&&url.pathname==='/health/ready') return json(res,200,{ready:true,service:'spmt-rtc-gateway',mode:'canary-hmac',rooms:hub.snapshot().length});
    return json(res,404,{error:'not_found'});
  });
  const prune=setInterval(()=>hub.pruneIdle(),15000); prune.unref();
  server.on('upgrade',(req,socket,head)=>{void handleUpgrade(req,socket,head).catch(()=>destroy(socket));});

  async function handleUpgrade(req,socket,head){
    const url=new URL(req.url??'/','http://rtc.local');
    if(url.pathname!==PATH) return reject(socket,404,'Not Found');
    if(String(req.headers.upgrade??'').toLowerCase()!=='websocket'||!String(req.headers.connection??'').toLowerCase().split(',').map(v=>v.trim()).includes('upgrade')) return reject(socket,400,'Bad Request');
    if(req.headers['sec-websocket-version']!=='13') return reject(socket,426,'Upgrade Required');
    const key=String(req.headers['sec-websocket-key']??''); if(!/^[A-Za-z0-9+/]{22}==$/.test(key)) return reject(socket,400,'Bad Request');
    const protocols=String(req.headers['sec-websocket-protocol']??'').split(',').map(v=>v.trim()).filter(Boolean);
    if(!protocols.includes('spmt-rtc-v1')) return reject(socket,400,'SPMT RTC protocol required');
    const ticket=protocols.find(v=>v.startsWith('spmt-rtc-auth.'));
    const requested={tenantId:clean(url.searchParams.get('tenantId'),'tenantId'),roomId:clean(url.searchParams.get('roomId'),'roomId'),participantId:clean(url.searchParams.get('participantId'),'participantId'),role:role(url.searchParams.get('role')),expiresAt:ticketExpiry(ticket)};
    if(requested.tenantId!==tenantId||requested.roomId!==roomId) return reject(socket,403,'Canary fence mismatch');
    if(!ticket||!verifySpmtRtcCanaryTicketV1(secret,requested,ticket,Date.now())) return reject(socket,401,'Unauthorized');
    const accept=createHash('sha1').update(key+WS_GUID).digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\nSec-WebSocket-Protocol: spmt-rtc-v1\r\n\r\n');
    const ws=new NarrowServerWebSocket(socket,head);
    await adapter.attach(ws,{tenantId:requested.tenantId,roomId:requested.roomId,participantId:requested.participantId,role:requested.role,authorization:'Bearer spmt-rtc-canary-authorized'});
  }
  return {server,hub,async listen(){await new Promise((ok,no)=>{server.once('error',no);server.listen(port,host,()=>{server.off('error',no);ok();});});const address=server.address();if(!address||typeof address==='string')throw new Error('SPMT RTC gateway did not bind TCP');return address.port;},async close(){clearInterval(prune);for(const room of hub.snapshot())void room;await new Promise((ok,no)=>server.close(err=>err?no(err):ok()));}};
}

class NarrowServerWebSocket{
  #socket;#buffer=Buffer.alloc(0);#binary=()=>{};#closed=()=>{};#ended=false;
  constructor(socket,head){this.#socket=socket;socket.on('data',chunk=>this.#feed(chunk));socket.on('close',()=>this.#finish());socket.on('error',()=>this.#finish());if(head?.length)this.#feed(head);}
  send(data){if(this.#ended||this.#socket.destroyed)return false;const payload=Buffer.from(data);if(payload.length>65536)return false;const ok=this.#socket.write(frame(0x2,payload));return ok&&this.#socket.writableLength<1024*1024;}
  close(code=1000,reason=''){if(this.#ended)return;this.#ended=true;const text=Buffer.from(String(reason).slice(0,100));const payload=Buffer.alloc(2+text.length);payload.writeUInt16BE(code,0);text.copy(payload,2);try{this.#socket.end(frame(0x8,payload));}catch{destroy(this.#socket);}this.#closed();}
  onBinary(fn){this.#binary=fn;}
  onClose(fn){this.#closed=fn;}
  #finish(){if(this.#ended)return;this.#ended=true;this.#closed();}
  #feed(chunk){if(this.#ended)return;this.#buffer=Buffer.concat([this.#buffer,Buffer.from(chunk)]);while(this.#parse()){} }
  #parse(){const b=this.#buffer;if(b.length<2)return false;const fin=(b[0]&0x80)!==0,rsv=b[0]&0x70,opcode=b[0]&0x0f,masked=(b[1]&0x80)!==0;let len=b[1]&0x7f,offset=2;if(!fin||rsv||!masked)return this.#protocolClose(1002,'Unsupported frame');if(len===126){if(b.length<4)return false;len=b.readUInt16BE(2);offset=4;}else if(len===127){if(b.length<10)return false;const n=b.readBigUInt64BE(2);if(n>65536n)return this.#protocolClose(1009,'Frame too large');len=Number(n);offset=10;}if(len>65536)return this.#protocolClose(1009,'Frame too large');if(b.length<offset+4+len)return false;const mask=b.subarray(offset,offset+4);offset+=4;const payload=Buffer.from(b.subarray(offset,offset+len));for(let i=0;i<payload.length;i++)payload[i]^=mask[i&3];this.#buffer=b.subarray(offset+len);if(opcode===0x2){this.#binary(payload);return true;}if(opcode===0x8){this.close(1000,'');return false;}if(opcode===0x9){this.#socket.write(frame(0xA,payload));return true;}if(opcode===0xA)return true;return this.#protocolClose(1003,'Binary audio only');}
  #protocolClose(code,reason){this.close(code,reason);return false;}
}
function frame(opcode,payload){const len=payload.length;let head;if(len<126){head=Buffer.from([0x80|opcode,len]);}else if(len<=65535){head=Buffer.alloc(4);head[0]=0x80|opcode;head[1]=126;head.writeUInt16BE(len,2);}else{head=Buffer.alloc(10);head[0]=0x80|opcode;head[1]=127;head.writeBigUInt64BE(BigInt(len),2);}return Buffer.concat([head,payload]);}
function ticketExpiry(ticket){const m=/^spmt-rtc-auth\.(\d{10,16})\./.exec(String(ticket??''));return m?Number(m[1]):0;}
function role(value){if(value==='browser'||value==='discord-bridge'||value==='persona'||value==='music')return value;throw new Error('role is invalid');}
function clean(value,name){const v=String(value??'').trim();if(!v||v.length>160||/[\r\n\0]/.test(v))throw new Error(name+' is invalid');return v;}
function reject(socket,status,message){try{socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);}catch{destroy(socket);}}
function destroy(socket){try{socket.destroy();}catch{}}
function json(res,status,value){const body=Buffer.from(JSON.stringify(value));res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':body.length,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(body);}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.env.SPMT_RTC_AUTH_MODE!=='canary-hmac')throw new Error('SPMT_RTC_AUTH_MODE=canary-hmac is required before the fenced gateway can start');
  const gateway=createSpmtRtcGateway({secret:process.env.SPMT_RTC_CANARY_SECRET,tenantId:process.env.SPMT_RTC_CANARY_TENANT,roomId:process.env.SPMT_RTC_CANARY_ROOM,host:process.env.HOST??'0.0.0.0',port:Number(process.env.PORT??8094)});
  const bound=await gateway.listen();process.stdout.write(`SPMT RTC fenced canary gateway listening on ${bound}\n`);
  const stop=async()=>{await gateway.close();process.exit(0);};process.once('SIGTERM',stop);process.once('SIGINT',stop);
}
