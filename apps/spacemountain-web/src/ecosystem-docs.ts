import {readFileSync} from 'node:fs';
const documents={
 '/docs':{file:'ECOSYSTEM_USER_GUIDE.md',title:'ApolloStation ecosystem guide'},
 '/docs/streamweaver':{file:'ECOSYSTEM_USER_GUIDE.md',title:'StreamWeaver guide'},
 '/docs/developers/streamweaver':{file:'architecture/STREAMWEAVER_ECOSYSTEM_INTEGRATION.md',title:'StreamWeaver ecosystem integration'},
 '/docs/streamweaver/parity':{file:'STREAMWEAVER_PARITY_CHECKPOINT_2026-09-06.md',title:'StreamWeaver parity checkpoint'},
} as const;
const escape=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
/** Only these repository-owned documents are served; request paths never select filesystem paths. */
export function renderEcosystemDocs(path:string,build:string):string|undefined{
 if(!Object.hasOwn(documents,path))return;
 const doc=documents[path as keyof typeof documents],content=readFileSync(new URL('../../../docs/'+doc.file,import.meta.url),'utf8');
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(doc.title)}</title><link rel="stylesheet" href="/assets/web/developer-docs.css"></head><body><header class="docs-header"><a href="/">← ApolloStation</a><span>ECOSYSTEM DOCUMENTATION</span><small>Build ${escape(build)}</small></header><main><nav class="toc"><a href="/docs">User guide</a><a href="/docs/developers">Developer quickstart</a><a href="/docs/developers/streamweaver">Integration reference</a><a href="/docs/streamweaver/parity">Current parity status</a></nav><article>${renderMarkdown(content,doc.file)}</article></main></body></html>`;
}
/** Small escaped renderer for the controlled headings, paragraphs, tables, lists and code in these guides. */
function renderMarkdown(markdown:string,file:string){
 const lines=markdown.split('\n'),out:string[]=[];let i=0;
 const inline=(text:string)=>escape(text).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\[([^\]]+)\]\(([^)]+)\)/g,(_m,label,target)=>{
  let href:string;
  if(/^https:\/\//.test(target)){try{const u=new URL(target.replaceAll('&amp;','&'));if(u.username||u.password)return label;href=u.href}catch{return label}}
  else {if(/^[a-z][a-z0-9+.-]*:|^\/\//i.test(target))return label;const resolved=new URL(target,'https://github.com/Mtman1987/ApolloStation/blob/main/docs/'+file);href=resolved.href;}
  const local:Record<string,string>={'ECOSYSTEM_USER_GUIDE.md':'/docs','STREAMWEAVER_PARITY_CHECKPOINT_2026-09-06.md':'/docs/streamweaver/parity','architecture/STREAMWEAVER_ECOSYSTEM_INTEGRATION.md':'/docs/developers/streamweaver'};
  for(const [suffix,path] of Object.entries(local))if(href.endsWith('/docs/'+suffix))href=path;
  return '<a href="'+escape(href)+'">'+label+'</a>';
 });
 while(i<lines.length){const line=lines[i]??'';if(!line.trim()){i++;continue}
  if(line.startsWith('```')){const code:string[]=[];i++;while(i<lines.length&&!lines[i]!.startsWith('```'))code.push(lines[i++]!);i++;out.push('<pre><code>'+escape(code.join('\n'))+'</code></pre>');continue}
  const heading=/^(#{1,6}) (.+)$/.exec(line);if(heading){out.push(`<h${heading[1]!.length}>${inline(heading[2]!)}</h${heading[1]!.length}>`);i++;continue}
  if(line.startsWith('|')&&/^\|[\s:|\-]+$/.test(lines[i+1]??'')){const cells=(s:string)=>s.replace(/^\||\|$/g,'').split('|').map(v=>inline(v.trim()));out.push('<div class="table-wrap"><table><thead><tr>'+cells(line).map(c=>'<th>'+c+'</th>').join('')+'</tr></thead><tbody>');i+=2;while(i<lines.length&&lines[i]!.startsWith('|'))out.push('<tr>'+cells(lines[i++]!).map(c=>'<td>'+c+'</td>').join('')+'</tr>');out.push('</tbody></table></div>');continue}
  if(/^[-*] /.test(line)){out.push('<ul>');while(i<lines.length&&/^[-*] /.test(lines[i]!))out.push('<li>'+inline(lines[i++]!.slice(2))+'</li>');out.push('</ul>');continue}
  const paragraph=[line];i++;while(i<lines.length&&lines[i]!.trim()&&!/^(#|\||```|[-*] )/.test(lines[i]!))paragraph.push(lines[i++]!);out.push('<p>'+inline(paragraph.join(' '))+'</p>');
 }
 return out.join('\n');
}
