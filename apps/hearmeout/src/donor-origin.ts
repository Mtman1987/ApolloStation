// Single source for the donor HearMeOut origin. The default keeps today's
// behaviour; HEARMEOUT_DONOR_ORIGIN can repoint it. Validation stays fail-closed.
export const HEARMEOUT_DONOR_DEFAULT_ORIGIN='https://hearmeout-main.fly.dev';

export function configuredDonorOrigin(environment:Record<string,string|undefined>=process.env):string{
  const value=environment.HEARMEOUT_DONOR_ORIGIN;
  if(value===undefined||value==='')return HEARMEOUT_DONOR_DEFAULT_ORIGIN;
  let url:URL;try{url=new URL(value);}catch{throw Error('HEARMEOUT_DONOR_ORIGIN must be a valid origin');}
  if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw Error('HEARMEOUT_DONOR_ORIGIN must be a credential-free HTTPS origin');
  return url.origin;
}
