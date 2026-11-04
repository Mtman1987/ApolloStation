import {createHash} from 'node:crypto';
import type {StreamWeaverDonorCommandInvocationV1} from './donor-command-runtime.js';
import type {StreamWeaverPokemonStore,PokemonAction} from './pokemon-store.js';
/** Chat and web use the same game transactions; Discord needs no separate inventory. */
export function executePokemonCommand(store:StreamWeaverPokemonStore,invocation:StreamWeaverDonorCommandInvocationV1){
 if(!invocation.actor.userId)throw Error('Link your account before using Pokémon');
 const [op,...args]=invocation.canonicalTrigger==='pack'?['open',...invocation.args]:invocation.args,operation=(op||'collection').toLowerCase(),actor={id:invocation.actor.userId,displayName:invocation.actor.displayName,owner:invocation.actor.isBroadcaster},state=store.snapshot(invocation.tenantId,actor);
 if(operation==='help')return '!pokemon join | packs | open [set] | eevee | collection | show <card-id> | pokedex [name] | team <three card IDs> | queue | battle | attack [battle-id] | switch [battle-id] | trade @trainer | offer <card-id> | accept | cancel-trade. Owners: grant @trainer <set> <count>, leader @trainer, season <id>.';
 if(operation==='packs')return Object.entries(state.trainer.packs).map(([set,n])=>`${set}: ${n}`).join(' · ')||'You have no unopened packs.';
 if(operation==='sets')return state.sets.map(s=>`${s.id}: ${s.name}`).join(' · ')||'The owner has not loaded a set.';
 if(operation==='deck'&&!args.length)return state.trainer.team.join(' · ')||'Use !pokemon team followed by three owned card IDs.';
 if(operation==='pokedex'){const page=store.pokedex(invocation.tenantId,actor,args.join(' '),0,8);return page.cards.map(c=>`${c.name} (${c.setCode}-${c.number}) · owned ${c.ownedCount}`).join(' | ')||'No cards matched the loaded sets.';}
 if(operation==='download')return 'Open StreamWeaver → Games → Pokédex to download an owned card PNG or your collection JSON.';
 const action=({deck:'team',card:'show',collections:'collection',cancel:'cancel-trade',eevee:'open'} as Record<string,string>)[operation]??operation;
 const input:PokemonAction={action,requestId:createHash('sha256').update(invocation.deliveryId).digest('hex')};
 if(action==='open'&&(operation==='eevee'||args[0]))input.set=operation==='eevee'?'eevee':args[0]!;
 if(action==='show')input.card=args.join(' ');
 if(action==='team')input.team=args.flatMap(a=>a.split(',')).filter(Boolean);
 if(action==='season')input.season=args[0]??'';
 if(['trade','leader','grant'].includes(action)){const target=invocation.target?.userId??state.trainers.find(t=>t.id===args[0])?.id;if(!target)throw Error('Mention a linked trainer, or use their trainer ID from Games');input.userId=target;if(action==='grant'){input.set=args[1]??'';input.count=Number(args[2]??1)}}
 if(['offer','accept','cancel-trade'].includes(action)){const explicit=state.trades.find(t=>t.id===args[0]),active=state.trades.filter(t=>t.expiresAt>Date.now());input.tradeId=explicit?.id??(active.length===1?active[0]!.id:'');if(!input.tradeId)throw Error('Choose your active trade ID from Games');if(action==='offer')input.card=(explicit?args.slice(1):args).join(' ');}
 if(['attack','switch'].includes(action)){const active=state.battles.filter(b=>!b.winner&&b.expiresAt>Date.now());input.battleId=args[0]??(active.length===1?active[0]!.id:'');if(!input.battleId)throw Error('Choose your active battle ID from Games');}
 const result=store.act(invocation.tenantId,actor,input);return String(result.text??'Pokémon action completed.');
}
