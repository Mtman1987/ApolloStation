/** Download only documented provider media hosts, without credentials or redirects. */
export async function downloadGeneratedImage(value:string,fetchImpl:typeof fetch=fetch){
  const url=new URL(value),allowed=["edenai.run","seaart.ai","seaart.me","seaart.io","seaart.tv"];
  if(url.protocol!=="https:"||url.username||url.password||(url.port&&url.port!=="443")||!allowed.some(h=>url.hostname===h||url.hostname.endsWith('.'+h)))throw new Error("Generated image uses an unapproved media host");
  const response=await fetchImpl(url,{redirect:"error",signal:AbortSignal.timeout(30000)}),contentType=(response.headers.get("content-type")??"").split(';')[0]!;
  if(!response.ok||!["image/png","image/jpeg","image/webp","image/gif"].includes(contentType))throw new Error("Provider did not return a supported image");
  const chunks:Uint8Array[]=[];let length=0;const reader=response.body?.getReader();if(!reader)throw new Error("Generated image was empty");
  try{while(true){const r=await reader.read();if(r.done)break;length+=r.value.length;if(length>8*1024*1024)throw new Error("Generated image exceeded 8 MiB");chunks.push(r.value);}}finally{await reader.cancel();}
  if(length<8)throw new Error("Generated image was empty");return {bytes:Buffer.concat(chunks),contentType};
}
