import { assertAppSurfaceManifestV1, type AppSurfaceManifestV1 } from "@spmt/contracts/surface";

export function appSurfaceBrowserJs(manifest: AppSurfaceManifestV1) {
  const value = JSON.stringify(assertAppSurfaceManifestV1(manifest)).replace(/</g, "\\u003c");
  return String.raw`;(()=>{const manifest=${value},body=document.body;function send(message){if(window.parent!==window)window.parent.postMessage(message,'*')}function show(pageId){const page=[...document.querySelectorAll('[data-page],[data-hmo-view-panel]')].find(node=>(node.getAttribute('data-page')||node.getAttribute('data-hmo-view-panel'))===pageId);if(!page)return false;for(const node of document.querySelectorAll('[data-page],[data-hmo-view-panel]'))node.hidden=node!==page;for(const button of document.querySelectorAll('[data-nav]'))button.setAttribute('aria-current',button.getAttribute('data-nav')===pageId?'page':'false');body.dataset.spmtPage=pageId;if(body.dataset.hmoView!==undefined)body.dataset.hmoView=pageId;send({protocol:'spmt.surface',version:1,type:'page.changed',appId:manifest.appId,pageId});return true}function publish(){send({protocol:'spmt.surface',version:1,type:'surface.manifest',manifest})}window.addEventListener('message',event=>{const message=event.data;if(!message||message.protocol!=='spmt.surface'||message.version!==1||message.appId!==manifest.appId)return;if(message.type==='page.open')show(message.pageId)});window.addEventListener('message',event=>{const message=event.data;if(message?.protocol==='spmt.embed'&&message?.version===1&&message?.type==='host.hello'&&message.launch?.appId===manifest.appId)publish()});for(const button of document.querySelectorAll('[data-nav]'))button.addEventListener('click',()=>{const pageId=button.getAttribute('data-nav');if(pageId)send({protocol:'spmt.surface',version:1,type:'page.changed',appId:manifest.appId,pageId})});publish()})();`;
}

export function productSurfaceManifest(input: {
  appId: string;
  sceneUrl: string;
  scenePosition?: string;
  sections: ReadonlyArray<{ id: string; label: string; body?: string; glyph?: string }>;
  shortcuts?: ReadonlyArray<{ id: string; label: string; pageId: string }>;
}): AppSurfaceManifestV1 {
  return assertAppSurfaceManifestV1({
    schemaVersion: 1,
    appId: input.appId,
    scene: { imageUrl: input.sceneUrl, ...(input.scenePosition ? { imagePosition: input.scenePosition } : {}) },
    pages: [
      { id: "home", label: "Home", description: "Application home", glyph: "⌂", home: true },
      ...input.sections.map((section) => ({ id: section.id, label: section.label, ...(section.body ? { description: section.body } : {}), ...(section.glyph ? { glyph: section.glyph } : {}) })),
    ],
    ...(input.shortcuts?.length ? { shortcuts: input.shortcuts.map((shortcut) => ({ ...shortcut })) } : {}),
  });
}
