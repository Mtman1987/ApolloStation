import {createServer,request as httpRequest} from 'node:http';
import {lookup} from 'node:dns/promises';
import {createConnection,isIP,type Socket} from 'node:net';

/** FFmpeg's HTTP(S) inputs, redirects and nested HLS references all traverse
 * this loopback proxy. DNS is checked then pinned for the actual socket. */
export class HearMeOutBroadcastEgress {
  private readonly sockets = new Set<Socket>();
  private readonly server = createServer(async (request,response) => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') throw Error('Read-only media egress');
      const url = new URL(request.url ?? '');
      if (url.protocol !== 'http:' || url.username || url.password) throw Error('Invalid media URL');
      const address = await this.address(url);
      const upstream = httpRequest({host:address,port:Number(url.port||80),method:request.method,path:url.pathname+url.search,headers:{host:url.host,...(request.headers.range?{range:request.headers.range}:{}),'user-agent':'HearMeOut room broadcast'},timeout:15000},remote=>{response.writeHead(remote.statusCode??502,remote.headers);remote.pipe(response);});
      upstream.on('timeout',()=>upstream.destroy());upstream.on('error',()=>{if(!response.headersSent)response.writeHead(502);response.end();});response.on('close',()=>upstream.destroy());upstream.end();
    } catch {response.writeHead(403);response.end('Media source is unavailable');}
  });
  constructor(private readonly trustedMedia?: {origin:string; pathPrefix:string}) {
    this.server.on('connection',socket=>{this.sockets.add(socket);socket.on('close',()=>this.sockets.delete(socket));});
    this.server.on('connect',async(request,socket,head)=>{
      try {
        const url = new URL('https://'+request.url);
        // CONNECT cannot constrain an HTTP path, so private targets never tunnel.
        const address = await this.address(url,false);
        const remote = createConnection({host:address,port:Number(url.port||443)});
        this.sockets.add(remote);remote.on('close',()=>this.sockets.delete(remote));remote.setTimeout(30000,()=>remote.destroy());
        remote.on('connect',()=>{socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)remote.write(head);remote.pipe(socket);socket.pipe(remote);});
        remote.on('error',()=>socket.destroy());socket.on('error',()=>remote.destroy());socket.on('close',()=>remote.destroy());
      } catch {socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');}
    });
  }
  private async address(url:URL,allowTrusted=true) {
    const host=url.hostname.replace(/^\[|\]$/g,''),addresses=isIP(host)?[{address:host,family:isIP(host)}]:await lookup(host,{all:true});
    const trusted=allowTrusted&&this.trustedMedia?.origin===url.origin&&url.pathname.startsWith(this.trustedMedia.pathPrefix)&&/^[A-Za-z0-9_-]{43}$/.test(url.pathname.slice(this.trustedMedia.pathPrefix.length));
    if(!addresses.length||(!trusted&&addresses.some(entry=>!isPublicBroadcastAddress(entry.address))))throw Error('Media address is not public');
    return addresses[0]!.address;
  }
  async listen(){await new Promise<void>((resolve,reject)=>{this.server.once('error',reject);this.server.listen(0,'127.0.0.1',()=>{this.server.off('error',reject);resolve();});});return `http://127.0.0.1:${(this.server.address() as {port:number}).port}`;}
  async close(){for(const socket of this.sockets)socket.destroy();if(this.server.listening)await new Promise<void>(resolve=>this.server.close(()=>resolve()));}
}
export function isPublicBroadcastAddress(address:string){
  if(isIP(address)===6)return /^[23]/i.test(address)&&!/^2001:db8:/i.test(address);
  if(isIP(address)!==4)return false;
  const [a,b,c]=address.split('.').map(Number) as [number,number,number,number];
  return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0||(b===88&&c===99)))||(a===198&&(b===18||b===19||(b===51&&c===100)))||(a===203&&b===0&&c===113));
}
