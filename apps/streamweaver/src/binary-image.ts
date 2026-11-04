export interface StreamWeaverBinaryImage {contentType:string;base64:string;}
export function decodeBinaryImage(image:StreamWeaverBinaryImage){
 if(typeof image?.base64!=='string'||image.base64.length>Math.ceil(8*1024*1024/3)*4||!image.base64.length||image.base64.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(image.base64))throw Error('Generated image encoding is invalid or exceeds 8 MiB');
 const bytes=Buffer.from(image.base64,'base64');if(bytes.length<8||bytes.length>8*1024*1024||bytes.toString('base64')!==image.base64)throw Error('Generated image encoding is invalid');
 const type=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'image/webp':/^GIF8[79]a/.test(bytes.toString('ascii',0,6))?'image/gif':undefined;
 if(!type||type!==image.contentType)throw Error('Generated image content does not match its declared format');return {bytes,contentType:type};
}
