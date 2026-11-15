import {generatePuzzle,canRemove,getRemovable,getArrowMove,GENERATOR_VERSION} from './engine.js';
import {applyRedirectorFlips,flippedRedirectorIds,restoreRedirectors} from './routing.js';
import {CubeView} from './cube-view.js';
import {loadProgress,saveProgress} from './storage.js';
import {GameAudio} from './audio.js';
import winVoiceURL from '../assets/audio/tracks/voice-2-boy.wav?url';
import {setupInstall} from './install.js';
import {normalizeTheme} from './theme.js';
import {setupThemeControls} from './theme-controls.js';
import {createColorWheel} from './color-wheel.js';
import {createWinCelebration} from './celebration.js';
import {MAX_HEARTS,MAX_RESETS,recoverResets,restoreResets,spendReset,normalizeCrashes,recoveryCountdown,resetRechargeFraction} from './lives.js';

const $ = id => document.getElementById(id);
let puzzle, removed = new Set(), blocked = new Set(), moves = 0, busy = false, hintId = null, hintReverse = false, generation = 0, toastTimer;
const saved = loadProgress();
let theme = normalizeTheme(saved?.theme);
let resets = restoreResets(saved,Date.now()), crashes = 0;
let bestSize = saved?.bestSize || 5, soundEnabled = saved?.sound ?? true;
const requestedMotion = new URLSearchParams(window.location.search).get('motion');
let motionMode = ['auto', 'full', 'reduced'].includes(requestedMotion) ? requestedMotion : saved?.motion || 'full';
const audio = new GameAudio(soundEnabled,{winVoiceURL});
let view;
const winCelebration = createWinCelebration($('win-confetti'));
$('win-dialog').addEventListener('close',()=>{winCelebration.stop();audio.stopWin();});
function notify(message){ $('toast').textContent=message; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),3500); }
function seed(){return crypto.getRandomValues(new Uint32Array(1))[0];}
function persist(){const ok=saveProgress({size:puzzle.size,seed:puzzle.seed,generatorVersion:puzzle.generatorVersion,removed:[...removed],blocked:[...blocked],flippedRedirectors:flippedRedirectorIds(puzzle),moves,crashes,resets,sound:soundEnabled,bestSize,motion:motionMode,theme});$('save-status').lastChild.textContent=ok?' Progress saved':' Saving unavailable';}
function paintResources(now){
  const hearts=Math.max(0,MAX_HEARTS-crashes);
  const recharge=resetRechargeFraction(resets,now);
  document.querySelectorAll('[data-heart]').forEach((icon,index)=>icon.classList.toggle('empty',index>=hearts));
  document.querySelectorAll('[data-reset]').forEach((icon,index)=>{
    const slot=index%MAX_RESETS;
    icon.classList.toggle('empty',slot>=resets.count);
    icon.classList.toggle('recharging',resets.nextAt!==null&&slot===resets.count);
    icon.style.setProperty('--reset-unfilled',`${((1-recharge)*100).toFixed(2)}%`);
  });
  $('hearts').setAttribute('aria-label',`${hearts} ${hearts===1?'heart':'hearts'} remaining`);
  $('reset-tokens').setAttribute('aria-label',`${resets.count} ${resets.count===1?'reset':'resets'} available. Refill hearts.`);
  $('reset-tokens').title=recoveryCountdown(resets,now);
  $('loss-resets').setAttribute('aria-label',`${resets.count} ${resets.count===1?'reset':'resets'} available`);
  $('reset-recharge-progress').hidden=resets.nextAt===null;
  $('reset-recharge-progress').value=Math.round(recharge*100);
  $('reset-recharge-progress').setAttribute('aria-valuetext',recoveryCountdown(resets,now));
}
function refreshResources(save = true){
  const now=Date.now(), recovered=recoverResets(resets,now);
  const changed=recovered.count!==resets.count||recovered.nextAt!==resets.nextAt;
  resets=recovered;
  paintResources(now);
  $('choose-size').disabled=crashes>=MAX_HEARTS;
  $('hint').disabled=crashes>=MAX_HEARTS;
  $('use-reset').hidden=resets.count===0||crashes===0;
  $('use-reset').disabled=crashes===0;
  $('loss-recharge').textContent=recoveryCountdown(resets,now);
  $('loss-title').textContent=crashes>=MAX_HEARTS?'Out of hearts.':'Refill your hearts?';
  $('loss-description').textContent=crashes===0?'Your hearts are full. Each crash costs one heart.'
    : resets.count>0?'Use a reset to refill all five hearts and keep your progress.'
    : 'Go back to wait for a reset, or restart this level.';
  if(changed&&save&&puzzle)persist();
}
function openRefill(){
  if(busy)return;
  refreshResources();
  if(!$('loss-dialog').open)$('loss-dialog').showModal();
}
function showLoss(){
  if(crashes<MAX_HEARTS)return;
  refreshResources();
  if(!$('loss-dialog').open)$('loss-dialog').showModal();
}
function update(){const count=puzzle.arrows.length;const percent=Math.round(removed.size/count*100);$('level').textContent=puzzle.size;$('dimension').textContent=`${puzzle.size} × ${puzzle.size}`;$('remaining').textContent=count-removed.size;$('progress-percent').textContent=`${percent}%`;$('completion').setAttribute('aria-valuenow',String(percent));$('progress-fill').style.width=`${percent}%`;$('hint-label').textContent=removed.size===count?'Next level':'Hint';$('sound').setAttribute('aria-pressed',String(soundEnabled));$('sound').textContent=soundEnabled?'On':'Off';refreshResources(false);persist();}
function start(size,boardSeed=seed(),restore=null){
  winCelebration.stop();audio.stopWin();
  if($('win-dialog').open)$('win-dialog').close();
  generation++;busy=false;hintId=null;hintReverse=false;
  crashes=normalizeCrashes(restore?.crashes);
  if($('loss-dialog').open)$('loss-dialog').close();
  clearTimeout(toastTimer);$('toast').classList.remove('visible');
  puzzle=generatePuzzle(size,boardSeed,restore?.generatorVersion??GENERATOR_VERSION);
  restoreRedirectors(puzzle,restore?.flippedRedirectors);
  const validIds=new Set(puzzle.arrows.map(a=>a.id));
  removed=new Set((restore?.removed||[]).filter(id=>validIds.has(id)));
  blocked=new Set((restore?.blocked||[]).filter(id=>validIds.has(id)&&!removed.has(id)));
  moves=restore?.moves||0;bestSize=Math.max(bestSize,size);
  view.setPuzzle(puzzle,removed,blocked);view.resetView();
  $('loading')?.remove();update();
  if(removed.size===puzzle.arrows.length)showWin();
  else if(crashes>=MAX_HEARTS)showLoss();
}
function showWin(celebrate=false){
  const maxed=puzzle.size>=64, dialog=$('win-dialog'), opening=!dialog.open;
  $('win-level').textContent=`Level ${puzzle.size} complete`;
  $('win-description').textContent=`All ${puzzle.arrows.length} arrows cleared.`;
  $('next-level').firstChild.textContent=maxed?'Play again · Level 64 ':`Next level · ${puzzle.size+1} `;
  if(opening)dialog.showModal();
  if(celebrate&&opening){audio.win();winCelebration.play();}
}
async function selectArrow(id,reverse=false){
  if(busy)return;
  if(crashes>=MAX_HEARTS){showLoss();return;}
  if(removed.has(id)||!puzzle.arrows.some(a=>a.id===id))return;
  const selected=puzzle.arrows.find(a=>a.id===id);
  if(reverse&&!selected.bidirectional)return;
  hintId=null;
  view.clearHighlight();
  clearTimeout(toastTimer);
  $('toast').classList.remove('visible');
  busy=true;
  const turn=generation;
  audio.prepare();
  try{
    if(!canRemove(puzzle,id,removed,reverse)){
      let impacted=false;
      await view.bumpArrow(id,{reverse,onImpact:()=>{
        if(turn!==generation||impacted)return;
        impacted=true;
        blocked.add(id);
        crashes++;
        refreshResources(false);
        persist();
        audio.blocked();
        if(crashes===MAX_HEARTS-1)notify('One heart left.');
      }});
      if(turn===generation&&crashes>=MAX_HEARTS)showLoss();
      return;
    }
    audio.swoosh();
    // Freeze the visual route before committing the move. Save removal and all
    // flips together, so a refresh during its animation restores a coherent board.
    const route=getArrowMove(puzzle,id,removed,reverse).route;
    const departure=view.removeArrow(id,{reverse});
    applyRedirectorFlips(puzzle,route);
    moves++;
    removed.add(id);
    blocked.delete(id);
    update();
    await departure;
    if(turn===generation&&removed.size===puzzle.arrows.length)showWin(true);
  }finally{
    if(turn===generation)busy=false;
  }
}
function hint(){if(busy)return;if(crashes>=MAX_HEARTS){showLoss();return;}if(removed.size===puzzle.arrows.length){showWin();return;}const available=getRemovable(puzzle,removed);if(!available.length)return;const arrow=available[0];hintId=arrow.id;hintReverse=Boolean(arrow.reverse);view.focusFace(arrow.face);view.highlight(arrow.id,'hint',hintReverse);notify(arrow.bidirectional?'The highlighted arrowhead has a clear route. Tap its half of the line.':'The highlighted arrow has a clear route. Tap it to let it go.');}
try{view=new CubeView($('cube-stage'),{onSelect:selectArrow,motion:motionMode,theme});start(saved?.size||5,saved?.seed??seed(),saved);}catch(error){console.error(error);$('loading').textContent='The 3D view could not start. Enable hardware acceleration or try another browser.';}
setupThemeControls({document,initial:theme,createWheel:createColorWheel,onChange:colors=>{theme=colors;view?.setTheme(theme);if(puzzle)persist();}});
$('motion-select').value=motionMode;
if(['auto','full','reduced'].includes(requestedMotion)){
  const cleanURL=new URL(window.location.href);
  cleanURL.searchParams.delete('motion');
  window.history.replaceState(window.history.state,'',cleanURL);
}
$('motion-select').addEventListener('change',()=>{
  motionMode=$('motion-select').value;
  view.setMotionMode(motionMode);
  persist();
  notify(motionMode==='full'?'Full arrow animations enabled.':motionMode==='reduced'?'Reduced motion enabled.':'Motion follows your device settings.');
});
$('hint').addEventListener('click',hint);
function restartPuzzle(){if(busy)return;start(puzzle.size,puzzle.seed,{generatorVersion:puzzle.generatorVersion});notify('A fresh start on the same puzzle.');}
$('loss-restart').addEventListener('click',restartPuzzle);
$('use-reset').addEventListener('click',()=>{
  if(busy||crashes===0)return;
  const spent=spendReset(resets,Date.now());
  if(!spent){refreshResources();return;}
  resets=spent;crashes=0;
  $('loss-dialog').close();
  update();
  notify('Hearts refilled.');
});
$('reset-tokens').addEventListener('click',openRefill);
$('loss-close').addEventListener('click',()=>$('loss-dialog').close());
$('sound').addEventListener('click',()=>{soundEnabled=!soundEnabled;audio.setEnabled(soundEnabled);update();if(soundEnabled)audio.swoosh();});
$('choose-size').addEventListener('click',()=>{if(crashes>=MAX_HEARTS){showLoss();return;}$('settings-dialog').close();$('size-input').value=puzzle.size;clearSizeError();syncChoice();$('difficulty-dialog').showModal();});
$('help').addEventListener('click',()=>$('help-dialog').showModal());
$('settings').addEventListener('click',()=>$('settings-dialog').showModal());
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(dialog!==$('loss-dialog')&&dialog!==$('theme-dialog')&&event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}}));
function clearSizeError(){
  $('size-input').setAttribute('aria-invalid','false');
  $('size-input').setAttribute('aria-describedby','size-help');
  $('size-error').textContent='';
}
function showSizeError(){
  $('size-error').textContent='Please enter a whole number from 2 to 64.';
  $('size-input').setAttribute('aria-invalid','true');
  $('size-input').setAttribute('aria-describedby','size-help size-error');
  $('size-input').focus();
}
function syncChoice(){
  const size=$('size-input').valueAsNumber;
  document.querySelectorAll('[data-size]').forEach(button=>{
    const selected=Number(button.dataset.size)===size;
    button.classList.toggle('selected',selected);
    button.setAttribute('aria-pressed',String(selected));
  });
  $('start-cube-label').textContent=$('size-input').validity.valid?`Start ${size} × ${size} cube`:'Start this cube';
}
document.querySelectorAll('[data-size]').forEach(button=>button.addEventListener('click',()=>{$('size-input').value=button.dataset.size;clearSizeError();syncChoice();}));
$('size-input').addEventListener('focus',event=>event.target.select());
$('size-input').addEventListener('input',()=>{clearSizeError();syncChoice();});
$('size-input').addEventListener('invalid',event=>{event.preventDefault();showSizeError();});
$('difficulty-form').addEventListener('submit',event=>{
  event.preventDefault();
  const size=$('size-input').valueAsNumber;
  if(!Number.isInteger(size)||size<2||size>64){showSizeError();return;}
  $('difficulty-dialog').close();
  start(size);
  notify(`Level ${size} ready.`);
});
$('next-level').addEventListener('click',()=>{$('win-dialog').close();start(Math.min(64,puzzle.size+1));notify(`Level ${puzzle.size} ready.`);});
$('cube-stage').addEventListener('keydown',event=>{if(event.defaultPrevented)return;const rotations={ArrowLeft:[-.22,0],ArrowRight:[.22,0],ArrowUp:[0,-.22],ArrowDown:[0,.22]};if(rotations[event.key]){event.preventDefault();view.rotateBy(...rotations[event.key]);}else if(event.key.toLowerCase()==='h'){event.preventDefault();hint();}else if(event.key==='Enter'&&hintId!==null){event.preventDefault();selectArrow(hintId,hintReverse);}});
setupInstall($('install'),notify);
setInterval(()=>{if(document.visibilityState!=='hidden')refreshResources();},1000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='hidden')refreshResources();});
window.addEventListener('pageshow',()=>refreshResources());
window.addEventListener('pagehide',()=>{winCelebration.stop();audio.stopWin();if(puzzle)persist();});
// Read-only diagnostics for reproducible QA; gameplay continues through the public controls.
window.__arrowCube={getState:()=>({size:puzzle?.size,gridSize:puzzle?.gridSize??puzzle?.size,generatorVersion:puzzle?.generatorVersion,seed:puzzle?.seed,remaining:puzzle?.arrows.length-removed.size,moves,crashes,hearts:MAX_HEARTS-crashes,resets:{...resets},lost:crashes>=MAX_HEARTS,removed:[...removed],blocked:[...blocked],available:puzzle?getRemovable(puzzle,removed).map(a=>a.id):[],availableMoves:puzzle?getRemovable(puzzle,removed).map(a=>({id:a.id,reverse:Boolean(a.reverse)})):[],wrapEdges:puzzle?.wrapEdges||[],redirectors:puzzle?.redirectors||[],bidirectional:puzzle?.arrows.filter(a=>a.bidirectional).map(a=>a.id)||[],busy,motion:motionMode,reducedMotion:view?.reducedMotion})};
