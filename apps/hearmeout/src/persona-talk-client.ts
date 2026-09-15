/** Deliberate bot-card requests. Text is visible before optional reply audio. */
export const HEARMEOUT_PERSONA_TALK_BROWSER_JS = String.raw`
(()=>{
const MAX_RECORDING_MS=8000;
async function api(url,init){const response=await fetch(url,{...init,signal:AbortSignal.timeout(20000)});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.message||data.error||('HearMeOut request failed ('+response.status+')'));return data}
async function waitReply(roomId,result,onProgress){
 if(!result.requestId)return result;
 let reply;
 for(let i=0;i<24;i++){
  let value;
  try{value=await api('/api/hearmeout/rooms/'+encodeURIComponent(roomId)+'/personas/requests/'+encodeURIComponent(result.requestId))}
  catch(error){if(reply)return {...reply,error:'The reply is ready, but audio could not be loaded.'};throw error}
  if(value.reply)reply=value;
  onProgress?.(value);
  if(value.state==='succeeded')return value;
  if(['failed','cancelled','dead-letter'].includes(value.state)){if(value.reply)return value;throw new Error(value.error||'The assistant request failed')}
  if(reply&&i>=5)return {...reply,pendingAudio:true,error:reply.error||'Text reply is ready; voice is still finishing in the background.'};
  await new Promise(r=>setTimeout(r,750));
 }
 if(reply)return {...reply,pendingAudio:true,error:'Text reply is ready; voice is still finishing in the background.'};
 throw new Error('The assistant did not return a reply in time. Try again.');
}
async function transcribe(roomId,tenantId,blob){
 if(!blob.size)throw new Error('I did not hear any audio. Please try again.');
 if(blob.size>8*1024*1024)throw new Error('Recorded audio is too large.');
 const asset=await api('/v1/media/assets?'+new URLSearchParams({name:'Room voice recording',purpose:'recording',sourceAppId:'hearmeout',expiresInSeconds:'3600'}),{method:'POST',headers:{'content-type':blob.type.split(';')[0],'x-spmt-tenant':tenantId,'idempotency-key':crypto.randomUUID()},body:blob});
 const accepted=await api('/api/hearmeout/rooms/'+encodeURIComponent(roomId)+'/personas/transcribe',{method:'POST',headers:{'content-type':'application/json','idempotency-key':crypto.randomUUID()},body:JSON.stringify({mediaAssetId:asset.id})});
 const result=await waitReply(roomId,accepted);return String(result.transcription||'').trim();
}
async function invoke(roomId,personaId,transcript,key=crypto.randomUUID(),{speak=true,onProgress}={}){
 const result=await api('/api/hearmeout/rooms/'+encodeURIComponent(roomId)+'/personas/'+encodeURIComponent(personaId)+'/invoke',{method:'POST',headers:{'content-type':'application/json','idempotency-key':key},body:JSON.stringify({message:transcript,speak})});
 return waitReply(roomId,result,onProgress);
}
function showReply(status,result,name,prefix=''){
 if(result.reply)status.textContent=prefix+name+': '+result.reply+(result.error?' · '+result.error:'');
}
function playReply(result,onDone,status){
 // Autoplay or a long audio reply must never hold the input or hide its text.
 if(onDone)Promise.resolve().then(()=>onDone(result)).catch(()=>{status.textContent+=' · Audio could not play. Your text reply is above.'});
}
function attachSend(button,input,status,{roomId,personaId,displayName,speech,onDone}){
 let previousMessage,key;
 button.addEventListener('click',async()=>{
  const message=input.value.trim();if(!message||button.disabled)return;
  if(previousMessage!==message){previousMessage=message;key=crypto.randomUUID()}
  button.disabled=true;button.textContent='Sending…';status.textContent='Sending to '+displayName+'…';
  try{
   const result=await invoke(roomId,personaId,message,key,{speak:speech?.synthesis!==false,onProgress:value=>{
    if(value.reply)showReply(status,value,displayName);else status.textContent=displayName+' is thinking…';
   }});
   showReply(status,result,displayName);
   if(!result.reply)status.textContent=displayName+' accepted the request.';
   if(input.value.trim()===message)input.value='';previousMessage=undefined;key=undefined;
   playReply(result,onDone,status);
  }catch(error){status.textContent=error instanceof Error?error.message:String(error)}
  finally{button.disabled=false;button.textContent='Send'}
 });
}
function attach(button,status,{roomId,tenantId,personaId,displayName,speech,onDone}){
 let recorder=null,recognition=null,stream=null,timer=null,finishTimer=null,busy=false;
 const cleanup=()=>{clearTimeout(timer);clearTimeout(finishTimer);stream?.getTracks().forEach(track=>track.stop());stream=null;recorder=null;recognition=null;busy=false;button.disabled=false;button.textContent='Talk to '+displayName};
 const fail=error=>{status.textContent=error instanceof Error?error.message:String(error);cleanup()};
 const send=async transcript=>{
  clearTimeout(timer);clearTimeout(finishTimer);button.disabled=true;button.textContent='Sending…';
  try{
   if(!transcript.trim())throw new Error('I did not hear any words. Please try again.');
   const prefix='You said: '+transcript+' · ';
   status.textContent=prefix+'Sending to '+displayName+'…';
   const result=await invoke(roomId,personaId,transcript,crypto.randomUUID(),{speak:speech?.synthesis!==false,onProgress:value=>showReply(status,value,displayName,prefix)});
   showReply(status,result,displayName,prefix);playReply(result,onDone,status);
  }catch(error){status.textContent=error instanceof Error?error.message:String(error)}finally{cleanup()}
 };
 const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(speech?.transcription===false&&Recognition)button.title='Use your browser’s speech recognition to talk';
 button.addEventListener('click',async()=>{
  if(recognition){recognition.stop();button.disabled=true;return}
  if(recorder&&recorder.state==='recording'){recorder.stop();return}
  if(busy)return;busy=true;button.disabled=true;status.textContent='Requesting microphone…';
  try{
   // Browser dictation is an explicit user action, independent of the server's
   // optional paid speech workers. No provider credentials leave the server.
   if(speech?.transcription===false){
    if(!Recognition)throw new Error('Voice input is unavailable in this browser. Type your message in Commlink instead.');
    const current=new Recognition();recognition=current;let transcript='',ended=false;
    current.lang=document.documentElement.lang||navigator.language||'en-US';current.continuous=false;current.interimResults=true;
    current.onstart=()=>{if(ended)return;button.disabled=false;button.textContent='Stop & send';status.textContent='Listening with browser speech recognition…';timer=setTimeout(()=>{current.stop();button.disabled=true},MAX_RECORDING_MS)};
    current.onresult=event=>{transcript=Array.from(event.results,result=>result[0].transcript).join(' ').trim();status.textContent='You said: '+transcript};
    current.onerror=event=>{if(ended)return;ended=true;current.abort();fail(new Error(event.error==='not-allowed'?'Microphone access was denied. Allow it in browser settings and try again.':event.error==='no-speech'?'I did not hear any words. Please try again.':'Browser speech recognition failed. Try again or use Commlink.'))};
    current.onend=()=>{if(ended)return;ended=true;recognition=null;void send(transcript)};
    finishTimer=setTimeout(()=>{if(ended)return;ended=true;current.abort();fail(new Error('Speech recognition timed out. Try again or use Commlink.'))},MAX_RECORDING_MS+12000);
    current.start();return;
   }
   if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw new Error('Voice recording is unavailable in this browser. Use Commlink instead.');
   stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
   const mimeType=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'].find(type=>MediaRecorder.isTypeSupported(type));
   if(!mimeType)throw new Error('This browser cannot record a supported audio format. Use Commlink instead.');
   const chunks=[];recorder=new MediaRecorder(stream,{mimeType});
   recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data)};
   recorder.onerror=()=>{const current=recorder;if(current)current.onstop=null;fail(new Error('Microphone recording failed. Please try again.'))};
   recorder.onstop=async()=>{clearTimeout(timer);stream?.getTracks().forEach(track=>track.stop());stream=null;button.disabled=true;try{status.textContent='Turning speech into text…';await send(await transcribe(roomId,tenantId,new Blob(chunks,{type:mimeType})))}catch(error){fail(error)}};
   recorder.start();button.disabled=false;button.textContent='Stop & send';status.textContent='Listening now. Sends automatically after 8 seconds.';
   timer=setTimeout(()=>{if(recorder?.state==='recording')recorder.stop()},MAX_RECORDING_MS);
  }catch(error){fail(error)}
 });
}
window.HearMeOutPersonaTalk={attach,attachSend,invoke,waitReply};
})();`;
