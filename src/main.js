import './style.css';
import {generatePuzzle,canRemove,getRemovable} from './engine.js';
import {CubeView} from './cube-view.js';
import {loadProgress,saveProgress} from './storage.js';
import {GameAudio} from './audio.js';
import {setupInstall} from './install.js';

const $ = id => document.getElementById(id);
let puzzle, removed = new Set(), moves = 0, busy = false, hintId = null, generation = 0, toastTimer;
const saved = loadProgress();
let bestSize = saved?.bestSize || 3, soundEnabled = saved?.sound ?? true;
const audio = new GameAudio(soundEnabled);
let view;
function notify(message){ $('toast').textContent=message; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),3500); }
function seed(){return crypto.getRandomValues(new Uint32Array(1))[0];}
function persist(){const ok=saveProgress({size:puzzle.size,seed:puzzle.seed,removed:[...removed],moves,sound:soundEnabled,bestSize});$('save-status').lastChild.textContent=ok?' Progress saved':' Saving unavailable';}
function update(){const count=puzzle.arrows.length;const percent=Math.round(removed.size/count*100);$('level').textContent=String(puzzle.size).padStart(2,'0');$('dimension').textContent=`${puzzle.size} × ${puzzle.size}`;$('remaining').textContent=count-removed.size;$('moves').textContent=moves;$('progress-percent').textContent=`${percent}%`;$('progress-fill').style.width=`${percent}%`;$('hint').lastChild.textContent=removed.size===count?' Next level':' Hint';$('sound').setAttribute('aria-pressed',String(soundEnabled));$('sound').setAttribute('aria-label',soundEnabled?'Turn sound off':'Turn sound on');$('sound').title=soundEnabled?'Sound on':'Sound off';$('sound').textContent=soundEnabled?'♫':'♪';persist();}
function start(size,boardSeed=seed(),restore=null){generation++;busy=false;hintId=null;puzzle=generatePuzzle(size,boardSeed);const validIds=new Set(puzzle.arrows.map(a=>a.id));removed=new Set((restore?.removed||[]).filter(id=>validIds.has(id)));moves=restore?.moves||0;bestSize=Math.max(bestSize,size);view.setPuzzle(puzzle,removed);view.resetView();$('loading')?.remove();update();if(removed.size===puzzle.arrows.length)showWin();}
function showWin(){const maxed=puzzle.size>=64;$('win-description').textContent=maxed?`You cleared the largest cube: ${puzzle.size} × ${puzzle.size}. Ready for a fresh challenge?`:`Level ${puzzle.size}, cleared in ${moves} moves. Your next cube is ${puzzle.size+1} × ${puzzle.size+1}, with a whole new set of paths.`;$('next-level').firstChild.textContent=maxed?'Another master cube ':'Next dimension ';if(!$('win-dialog').open)$('win-dialog').showModal();}
async function selectArrow(id){if(busy||removed.has(id)||!puzzle.arrows.some(a=>a.id===id))return;hintId=null;view.clearHighlight();if(!canRemove(puzzle,id,removed)){view.highlight(id,'blocked');audio.blocked();notify('Another line is in the way. Clear its path first.');return;}busy=true;const turn=generation;moves++;removed.add(id);update();audio.swoosh();try{await view.removeArrow(id);}finally{if(turn===generation){busy=false;if(removed.size===puzzle.arrows.length){audio.win();showWin();}}}}
function hint(){if(busy)return;if(removed.size===puzzle.arrows.length){showWin();return;}const available=getRemovable(puzzle,removed);if(!available.length)return;const arrow=available[0];hintId=arrow.id;view.focusFace(arrow.face);view.highlight(arrow.id,'hint');notify('The purple arrow has a clear path. Tap it to let it go.');}
try{view=new CubeView($('cube-stage'),{onSelect:selectArrow});start(saved?.size||3,saved?.seed??seed(),saved);}catch(error){console.error(error);$('loading').textContent='The 3D view could not start. Enable hardware acceleration or try another browser.';}
$('hint').addEventListener('click',hint);
$('reset-view').addEventListener('click',()=>view.resetView());
$('restart').addEventListener('click',()=>{if(busy)return;start(puzzle.size,puzzle.seed);notify('A fresh start on the same puzzle.');});
$('sound').addEventListener('click',()=>{soundEnabled=!soundEnabled;audio.setEnabled(soundEnabled);update();if(soundEnabled)audio.swoosh();});
$('choose-size').addEventListener('click',()=>{$('size-input').value=puzzle.size;syncChoice();$('difficulty-dialog').showModal();});
$('help').addEventListener('click',()=>$('help-dialog').showModal());
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}}));
function syncChoice(){document.querySelectorAll('[data-size]').forEach(b=>b.classList.toggle('selected',Number(b.dataset.size)===Number($('size-input').value)));}
document.querySelectorAll('[data-size]').forEach(button=>button.addEventListener('click',()=>{$('size-input').value=button.dataset.size;syncChoice();}));
$('size-input').addEventListener('input',syncChoice);
$('difficulty-form').addEventListener('submit',e=>{e.preventDefault();const size=Number($('size-input').value);if(!Number.isInteger(size)||size<2||size>64)return;$('difficulty-dialog').close();start(size);notify(`Level ${size} · ${size} × ${size} · Every arrow has a way out.`);});
$('next-level').addEventListener('click',()=>{$('win-dialog').close();start(Math.min(64,puzzle.size+1));notify(`Welcome to level ${puzzle.size}. A little bigger, a little deeper.`);});
$('cube-stage').addEventListener('keydown',event=>{if(event.defaultPrevented)return;const rotations={ArrowLeft:[-.22,0],ArrowRight:[.22,0],ArrowUp:[0,-.22],ArrowDown:[0,.22]};if(rotations[event.key]){event.preventDefault();view.rotateBy(...rotations[event.key]);}else if(event.key.toLowerCase()==='h'){event.preventDefault();hint();}else if(event.key==='Enter'&&hintId!==null){event.preventDefault();selectArrow(hintId);}});
if(matchMedia('(pointer:coarse)').matches)$('gesture-help').textContent='Drag to rotate · Pinch to zoom · Tap to release';
setupInstall($('install'),notify);
window.addEventListener('pagehide',()=>{if(puzzle)persist();});
// Read-only diagnostics for reproducible QA; gameplay continues through the public controls.
window.__arrowCube={getState:()=>({size:puzzle?.size,seed:puzzle?.seed,remaining:puzzle?.arrows.length-removed.size,moves,removed:[...removed],available:puzzle?getRemovable(puzzle,removed).map(a=>a.id):[],busy})};
