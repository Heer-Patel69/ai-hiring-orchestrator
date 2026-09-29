import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTextToSpeech } from "./TextToSpeech";
const voiceA={voiceURI:"consistent-voice",name:"Microsoft Natural",lang:"en-US"};
const voiceB={voiceURI:"another-voice",name:"Google",lang:"en-US"};
let voices:any[], utterances:any[], synthesis:any;
beforeEach(()=>{
  voices=[voiceA,voiceB];utterances=[];
  synthesis={getVoices:vi.fn(()=>voices),speak:vi.fn(u=>utterances.push(u)),cancel:vi.fn(),paused:false,addEventListener:vi.fn(),removeEventListener:vi.fn()};
  Object.defineProperty(window,"speechSynthesis",{configurable:true,value:synthesis});
  vi.stubGlobal("SpeechSynthesisUtterance",class {constructor(public text:string){} });
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("reports speaking only after actual playback starts and keeps one voice across turns",async()=>{
  const hook=renderHook(()=>useTextToSpeech());
  await act(async()=>hook.result.current.speak("First question?"));expect(hook.result.current.isSpeaking).toBe(false);
  act(()=>utterances[0].onstart());expect(hook.result.current.isSpeaking).toBe(true);
  act(()=>utterances[0].onend());expect(hook.result.current.isSpeaking).toBe(false);
  voices=[voiceB,voiceA];await act(async()=>hook.result.current.speak("Next question?"));
  expect(utterances.map(u=>u.voice.voiceURI)).toEqual([voiceA.voiceURI,voiceA.voiceURI]);
});
it("ignores obsolete speech callbacks after interruption",async()=>{
  const end=vi.fn();const hook=renderHook(()=>useTextToSpeech({onEnd:end}));
  await act(async()=>hook.result.current.speak("Old question?"));const oldEnd=utterances[0].onend;
  act(()=>hook.result.current.stop());await act(async()=>hook.result.current.speak("New question?"));act(()=>utterances[1].onstart());
  act(()=>oldEnd());expect(hook.result.current.isSpeaking).toBe(true);expect(end).not.toHaveBeenCalled();
});
it("explicitly errors when the locked voice disappears, without silently switching voices",async()=>{
  const error=vi.fn();const hook=renderHook(()=>useTextToSpeech({onError:error}));
  await act(async()=>hook.result.current.speak("First question?"));voices=[voiceB];await act(async()=>hook.result.current.speak("Next question?"));
  expect(synthesis.speak).toHaveBeenCalledTimes(1);expect(error).toHaveBeenCalledOnce();
});
