import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {BROADCAST_WINDOW_JS,renderHearMeOutBroadcastWindow} from '../apps/hearmeout/dist/broadcast-window.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function element(){const classes=new Set();return{listeners:{},dataset:{},value:'',textContent:'',hidden:false,disabled:false,readyState:2,children:[],classList:{contains:name=>classes.has(name),toggle(name,force){const add=force??!classes.has(name);add?classes.add(name):classes.delete(name);return add}},addEventListener(name,fn){this.listeners[name]=fn},setAttribute(){},append(...children){this.children.push(...children)},replaceChildren(...children){this.children=children},play:async()=>{},pause(){}}}
function fixture(search='?roomId=party',storageBlocked=false){
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id)};const main=node('main');
 const document={hidden:false,referrer:'https://discord.com',listeners:{},getElementById:node,querySelector:selector=>selector==='main'?main:node(selector),createElement:element,addEventListener(name,fn){this.listeners[name]=fn}};
 const listeners={},intervals=new Map(),loads=[],clears=[],opened=[],messages=[],location={search,origin:'https://watch.example',href:'https://watch.example/watch'+search};let sequence=0;
 const storage={getItem(){if(storageBlocked)throw Error('Storage denied');return null},setItem(){if(storageBlocked)throw Error('Storage denied')}};
 let state={sessionId:'party',revision:1,current:{requestId:'movie',item:{title:'Movie'}},queue:[],playback:{status:'playing'},broadcast:{configured:true,ready:true,epoch:'movie1',playbackUrl:'/movie/index.m3u8'},screen:{active:true,ready:true,title:'Host screen',epoch:'screen1',playbackUrl:'/screen/index.m3u8'}};
 const window={addEventListener:(name,fn)=>listeners[name]=fn,open:url=>{opened.push(url);return{focus(){}}},parent:{postMessage:(...args)=>messages.push(args)}};window.top=window;
 window.HearMeOutPlaybackSource=class{load(...args){loads.push(args)}clear(){clears.push(true)}syncLive(){}joinLive(){}};
 const requests=[];
 vm.runInNewContext(BROADCAST_WINDOW_JS,{window,document,location,URL,URLSearchParams,localStorage:storage,sessionStorage:storage,history:{replaceState:(_,__,url)=>{location.href=String(url)}},CLIENT_ID:'app',crypto:{randomUUID:()=>String(++sequence)},AbortSignal,setInterval:fn=>{intervals.set(++sequence,fn);return sequence},clearInterval:id=>intervals.delete(id),fetch:async path=>{requests.push(path);return{ok:true,headers:{get:()=> 'application/json'},json:async()=>state}}});
 return{node,main,document,listeners,intervals,loads,clears,opened,messages,requests,setState:value=>state={...state,...value}};
}
test('one player switches independently between movie/music and live screen output, even without a queued movie',async()=>{
 const f=fixture();await tick();assert.equal(f.loads.at(-1)[0],'/movie/index.m3u8');f.node('output').value='screen';f.node('output').listeners.change();assert.equal(f.loads.at(-1)[0],'/screen/index.m3u8');assert.equal(f.node('title').textContent,'Host screen');
 f.setState({current:null});await f.node('retry').listeners.click();await tick();assert.equal(f.loads.at(-1)[0],'/screen/index.m3u8');assert.equal(f.requests.some(path=>/\/join|\/rtc/.test(path)),false);
 f.node('output').value='program';f.node('output').listeners.change();assert.match(f.node('status').textContent,/Nothing playing|Broadcast/);assert.equal(f.loads.at(-1)[0],'/screen/index.m3u8','Switching to idle program clears the screen instead of starting another source');
});
test('Discord-restricted fullscreen expands the player with an exit control instead of directing users to a nonexistent button',async()=>{
 const f=fixture('?roomId=party&frame_id=discord&platform=desktop');await tick();f.main.requestFullscreen=async()=>{throw Error('Not allowed in iframe')};await f.node('fullscreen').listeners.click();assert.equal(f.main.classList.contains('expanded'),true);assert.equal(f.main.classList.contains('controls-hidden'),true);assert.equal(f.node('exit-expanded').hidden,false);assert.equal(f.node('playback-error').textContent,'');
 await f.node('exit-expanded').listeners.click();assert.equal(f.main.classList.contains('expanded'),false);assert.equal(f.node('popout').hidden,true);assert.equal(f.messages.length,0);
});
test('storage restrictions do not blank the player, and restored windows resume the selected screen feed',async()=>{
 const f=fixture('?roomId=party&output=screen',true);await tick();assert.equal(f.loads.at(-1)[0],'/screen/index.m3u8');f.listeners.pagehide();assert.equal(f.intervals.size,0);const loads=f.loads.length;f.listeners.pageshow({persisted:true});await tick();assert.equal(f.intervals.size,2);assert.equal(f.loads.length,loads+1);assert.equal(f.loads.at(-1)[0],'/screen/index.m3u8');
});
test('browser popout retains the party and selected output and pauses only the current viewer',async()=>{
 const f=fixture('?roomId=party&output=screen');await tick();f.node('popout').listeners.click();assert.match(f.opened[0],/roomId=party&output=screen/);assert.match(f.node('status').textContent,/Disconnected/);assert.equal(f.requests.some(path=>/control|pause/.test(path)),false);
});
test('the delivered watch page contains the shared output controls and a parseable Discord opener handshake',()=>{
 const html=renderHearMeOutBroadcastWindow('app');assert.match(html,/id="output"/);assert.match(html,/window\.parent\.opener/);assert.doesNotMatch(html,/Use Discord’s fullscreen|Use Discord’s Pop Out/);for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))assert.doesNotThrow(()=>new vm.Script(match[1]));
});
