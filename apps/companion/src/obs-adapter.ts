import {createHash,randomUUID} from "node:crypto";
import type {DeviceRelayCommandV1} from "@spmt/contracts";
import type {CompanionLocalAdapterV1} from "./device-relay.js";

/** OBS WebSocket v5. Passwords remain on the paired computer. */
export class CompanionObsWebSocket implements CompanionLocalAdapterV1 {
  private socket:WebSocket|undefined;
  private connecting:Promise<void>|undefined;
  private cancelConnect:(()=>void)|undefined;
  private readonly pending=new Map<string,{resolve:(value:Record<string,unknown>)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  constructor(private readonly options:{url:string;password?:string;timeoutMs?:number;socketFactory?:(url:string)=>WebSocket}){
    const url=new URL(options.url);if(!["ws:","wss:"].includes(url.protocol)||!["localhost","127.0.0.1","[::1]"].includes(url.hostname)||url.username||url.password||url.pathname!=="/"||url.search||url.hash)throw new Error("OBS must use a credential-free loopback WebSocket URL");
  }
  async connect(){
    if(this.connecting)return this.connecting;
    this.connecting=new Promise<void>((resolve,reject)=>{
      const socket=(this.options.socketFactory??(url=>new WebSocket(url,"obswebsocket.json")))(this.options.url);this.socket=socket;let identified=false;
      const timer=setTimeout(()=>{reject(new Error("OBS connection timed out"));this.close()},this.options.timeoutMs??10000);
      this.cancelConnect=()=>{clearTimeout(timer);reject(new Error("OBS connection closed"))};
      const failed=(error:Error)=>{clearTimeout(timer);reject(error);if(this.socket!==socket)return;this.socket=undefined;this.connecting=undefined;this.cancelConnect=undefined;for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(error)}this.pending.clear();if(socket.readyState<2)socket.close()};
      socket.addEventListener("error",()=>failed(new Error("OBS WebSocket could not be reached")));
      socket.addEventListener("close",()=>failed(new Error("OBS WebSocket disconnected")));
      socket.addEventListener("message",event=>{try{
        if(typeof event.data!=="string"||event.data.length>1000000)throw new Error("OBS returned an invalid message");
        const message=JSON.parse(event.data) as {op:number;d:Record<string,unknown>},data=message.d;
        if(message.op===0&&!identified){const authentication=data.authentication as {salt:string;challenge:string}|undefined;if(authentication&&!this.options.password)throw new Error("Set the local OBS_PASSWORD to connect to OBS");const sha=(text:string)=>createHash("sha256").update(text).digest("base64");socket.send(JSON.stringify({op:1,d:{rpcVersion:1,eventSubscriptions:0,...(authentication?{authentication:sha(sha(this.options.password!+authentication.salt)+authentication.challenge)}:{})}}));}
        else if(message.op===2){identified=true;clearTimeout(timer);this.cancelConnect=undefined;resolve();}
        else if(message.op===7){const pending=this.pending.get(String(data.requestId));if(!pending)return;this.pending.delete(String(data.requestId));clearTimeout(pending.timer);const status=data.requestStatus as {result:boolean;code?:number;comment?:string};if(status.result)pending.resolve((data.responseData??{}) as Record<string,unknown>);else pending.reject(new Error(`OBS rejected ${String(data.requestType)} (${status.code??"unknown"}): ${String(status.comment??"request failed").slice(0,400)}`));}
      }catch(error){failed(error instanceof Error?error:new Error("OBS response failed"));socket.close()}});
    });return this.connecting;
  }
  async request(requestType:string,requestData:Record<string,unknown>={}){await this.connect();const socket=this.socket;if(!socket||socket.readyState!==1)throw new Error("OBS is not connected");const requestId=randomUUID();return new Promise<Record<string,unknown>>((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(requestId);reject(new Error(`OBS ${requestType} timed out`))},this.options.timeoutMs??10000);this.pending.set(requestId,{resolve,reject,timer});try{socket.send(JSON.stringify({op:6,d:{requestType,requestId,requestData}}))}catch(error){clearTimeout(timer);this.pending.delete(requestId);reject(error)}})}
  async execute(command:DeviceRelayCommandV1){
    const payload=command.payload,name=(key:string)=>{const value=String(payload[key]??"").trim();if(!value||value.length>200||/[\r\n\0]/.test(value))throw new Error(`OBS ${key} is required`);return value};
    if(command.action==="obs.scene.set"){const sceneName=name("sceneName");await this.request("SetCurrentProgramScene",{sceneName});return{detail:`OBS scene changed to ${sceneName}`}}
    if(command.action==="obs.source.visibility.set"){
      const sceneName=name("sceneName"),sourceName=name("sourceName");if(typeof payload.visible!=="boolean")throw new Error("OBS visible must be boolean");
      const item=await this.request("GetSceneItemId",{sceneName,sourceName});
      if(!Number.isSafeInteger(item.sceneItemId)||Number(item.sceneItemId)<0)throw new Error("OBS source was not found in this scene");
      await this.request("SetSceneItemEnabled",{sceneName,sceneItemId:item.sceneItemId,sceneItemEnabled:payload.visible});
      return{detail:`OBS source ${sourceName} ${payload.visible?"shown":"hidden"} in ${sceneName}`};
    }
    const inputName=name("inputName");
    if(command.action==="media.play"||command.action==="media.pause")await this.request("TriggerMediaInputAction",{inputName,mediaAction:command.action==="media.play"?"OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY":"OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE"});
    else if(command.action==="media.seek"){const mediaCursor=Number(payload.positionMs);if(!Number.isSafeInteger(mediaCursor)||mediaCursor<0)throw new Error("OBS media positionMs must be nonnegative milliseconds");await this.request("SetMediaInputCursor",{inputName,mediaCursor});}
    else if(command.action==="media.volume.set"){const inputVolumeMul=Number(payload.volume);if(!Number.isFinite(inputVolumeMul)||inputVolumeMul<0||inputVolumeMul>1)throw new Error("OBS volume must be from 0 to 1");await this.request("SetInputVolume",{inputName,inputVolumeMul});}
    else if(command.action==="media.mute.set"){if(typeof payload.muted!=="boolean")throw new Error("OBS muted must be boolean");await this.request("SetInputMute",{inputName,inputMuted:payload.muted});}
    else throw new Error("This Companion adapter does not support the requested action");
    return{detail:`${command.action} completed for ${inputName}`};
  }
  close(){this.cancelConnect?.();this.cancelConnect=undefined;const socket=this.socket;this.socket=undefined;this.connecting=undefined;socket?.close();for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(new Error("OBS connection closed"))}this.pending.clear()}
}
