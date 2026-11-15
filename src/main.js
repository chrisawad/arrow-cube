import {generatePuzzle,canRemove,getRemovable,GENERATOR_VERSION} from './engine.js';
import {CubeView} from './cube-view.js';
import {loadProgress,saveProgress} from './storage.js';
import {GameAudio} from './audio.js';
import {setupInstall} from './install.js';

const $ = id => document.getElementById(id);
let puzzle, removed = new Set(), blocked = new Set(), moves = 0, busy = false, hintId = null, hintReverse = false, generation = 0, toastTimer;
const saved = loadProgress();
let bestSize = saved?.bestSize || 5, soundEnabled = saved?.sound ?? true;
const requestedMotion = new URLSearchParams(window.location.search).get('motion');
let motionMode = ['auto', 'full', 'reduced'].includes(requestedMotion) ? requestedMotion : saved?.motion || 'full';
const audio = new GameAudio(soundEnabled);
let view;
function notify(message){ $('toast').textContent=message; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),3500); }
function seed(){return crypto.getRandomValues(new Uint32Array(1))[0];}
function persist(){const ok=saveProgress({size:puzzle.size,seed:puzzle.seed,generatorVersion:puzzle.generatorVersion,removed:[...removed],blocked:[...blocked],moves,sound:soundEnabled,bestSize,motion:motionMode});$('save-status').lastChild.textContent=ok?' Progress saved':' Saving unavailable';}
function update(){const count=puzzle.arrows.length;const percent=Math.round(removed.size/count*100);$('level').textContent=String(puzzle.size).padStart(2,'0');$('dimension').textContent=`${puzzle.size} × ${puzzle.size}`;$('remaining').textContent=count-removed.size;$('moves').textContent=moves;$('progress-percent').textContent=`${percent}%`;$('progress-fill').style.width=`${percent}%`;$('hint').lastChild.textContent=removed.size===count?' Next level':' Hint';$('sound').setAttribute('aria-pressed',String(soundEnabled));$('sound').setAttribute('aria-label',soundEnabled?'Turn sound off':'Turn sound on');$('sound').title=soundEnabled?'Sound on':'Sound off';$('sound').textContent=soundEnabled?'♫':'♪';persist();}
function start(size,boardSeed=seed(),restore=null){
  generation++;busy=false;hintId=null;hintReverse=false;
  clearTimeout(toastTimer);$('toast').classList.remove('visible');
  puzzle=generatePuzzle(size,boardSeed,restore?.generatorVersion??GENERATOR_VERSION);
  const validIds=new Set(puzzle.arrows.map(a=>a.id));
  removed=new Set((restore?.removed||[]).filter(id=>validIds.has(id)));
  blocked=new Set((restore?.blocked||[]).filter(id=>validIds.has(id)&&!removed.has(id)));
  moves=restore?.moves||0;bestSize=Math.max(bestSize,size);
  view.setPuzzle(puzzle,removed,blocked);view.resetView();
  $('loading')?.remove();update();
  if(removed.size===puzzle.arrows.length)showWin();
}
function showWin(){const maxed=puzzle.size>=64;$('win-description').textContent=maxed?`You cleared the largest cube: ${puzzle.size} × ${puzzle.size}. Ready for a fresh challenge?`:`Level ${puzzle.size}, cleared in ${moves} moves. Your next cube is ${puzzle.size+1} × ${puzzle.size+1}, with a whole new set of paths.`;$('next-level').firstChild.textContent=maxed?'Another master cube ':'Next dimension ';if(!$('win-dialog').open)$('win-dialog').showModal();}
async function selectArrow(id,reverse=false){
  if(busy||removed.has(id)||!puzzle.arrows.some(a=>a.id===id))return;
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
        persist();
        audio.blocked();
        notify(selected.bidirectional?'That route is blocked. Clear it or try the other half.':'Another line is in the way. Clear its route first.');
      }});
      return;
    }
    audio.swoosh();
    moves++;
    removed.add(id);
    blocked.delete(id);
    update();
    await view.removeArrow(id,{reverse});
    if(turn===generation&&removed.size===puzzle.arrows.length){audio.win();showWin();}
  }finally{
    if(turn===generation)busy=false;
  }
}
function hint(){if(busy)return;if(removed.size===puzzle.arrows.length){showWin();return;}const available=getRemovable(puzzle,removed);if(!available.length)return;const arrow=available[0];hintId=arrow.id;hintReverse=Boolean(arrow.reverse);view.focusFace(arrow.face);view.highlight(arrow.id,'hint',hintReverse);notify(arrow.bidirectional?'The purple arrowhead has a clear route. Tap its half of the line.':'The purple arrow has a clear route. Tap it to let it go.');}
try{view=new CubeView($('cube-stage'),{onSelect:selectArrow,motion:motionMode});start(saved?.size||5,saved?.seed??seed(),saved);}catch(error){console.error(error);$('loading').textContent='The 3D view could not start. Enable hardware acceleration or try another browser.';}
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
$('reset-view').addEventListener('click',()=>view.resetView());
$('restart').addEventListener('click',()=>{if(busy)return;start(puzzle.size,puzzle.seed,{generatorVersion:puzzle.generatorVersion});notify('A fresh start on the same puzzle.');});
$('sound').addEventListener('click',()=>{soundEnabled=!soundEnabled;audio.setEnabled(soundEnabled);update();if(soundEnabled)audio.swoosh();});
$('choose-size').addEventListener('click',()=>{$('size-input').value=puzzle.size;clearSizeError();syncChoice();$('difficulty-dialog').showModal();});
$('help').addEventListener('click',()=>$('help-dialog').showModal());
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}}));
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
  notify(`Level ${size} · ${size} × ${size} · ${puzzle.arrows.length} arrows to untangle.`);
});
$('next-level').addEventListener('click',()=>{$('win-dialog').close();start(Math.min(64,puzzle.size+1));notify(`Welcome to level ${puzzle.size}. A little bigger, a little deeper.`);});
$('cube-stage').addEventListener('keydown',event=>{if(event.defaultPrevented)return;const rotations={ArrowLeft:[-.22,0],ArrowRight:[.22,0],ArrowUp:[0,-.22],ArrowDown:[0,.22]};if(rotations[event.key]){event.preventDefault();view.rotateBy(...rotations[event.key]);}else if(event.key.toLowerCase()==='h'){event.preventDefault();hint();}else if(event.key==='Enter'&&hintId!==null){event.preventDefault();selectArrow(hintId,hintReverse);}});
if(matchMedia('(pointer:coarse)').matches)$('gesture-help').textContent='Drag to rotate · Pinch to zoom · Tap to release';
setupInstall($('install'),notify);
window.addEventListener('pagehide',()=>{if(puzzle)persist();});
// Read-only diagnostics for reproducible QA; gameplay continues through the public controls.
window.__arrowCube={getState:()=>({size:puzzle?.size,gridSize:puzzle?.gridSize??puzzle?.size,generatorVersion:puzzle?.generatorVersion,seed:puzzle?.seed,remaining:puzzle?.arrows.length-removed.size,moves,removed:[...removed],blocked:[...blocked],available:puzzle?getRemovable(puzzle,removed).map(a=>a.id):[],availableMoves:puzzle?getRemovable(puzzle,removed).map(a=>({id:a.id,reverse:Boolean(a.reverse)})):[],wrapEdges:puzzle?.wrapEdges||[],redirectors:puzzle?.redirectors||[],bidirectional:puzzle?.arrows.filter(a=>a.bidirectional).map(a=>a.id)||[],busy,motion:motionMode,reducedMotion:view?.reducedMotion})};
