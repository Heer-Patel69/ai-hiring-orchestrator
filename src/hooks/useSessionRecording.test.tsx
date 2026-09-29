import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useInterviewRecording } from "./useSessionRecording";
const db = vi.hoisted(() => ({ upload: vi.fn(), signed: vi.fn(), insert: vi.fn(), update: vi.fn(), eq: vi.fn(), single: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: () => ({ insert: (...args: any[]) => { db.insert(...args); return { select: () => ({ single: db.single }) }; }, update: (...args: any[]) => { db.update(...args); return { eq: db.eq }; } }),
  storage: { from: () => ({ upload: db.upload, createSignedUrl: db.signed }) },
} }));
class Track { kind:string; readyState="live"; enabled=true; muted=false; stop=vi.fn(() => {this.readyState="ended";}); constructor(kind:string){this.kind=kind;} }
class Stream { tracks:Track[]; constructor(tracks:Track[]=[]){this.tracks=tracks;} getTracks(){return this.tracks;} getVideoTracks(){return this.tracks.filter(t=>t.kind==="video");} getAudioTracks(){return this.tracks.filter(t=>t.kind==="audio");} addTrack(track:Track){this.tracks.push(track);} }
class Recorder {
  static current:Recorder; static isTypeSupported=vi.fn((type:string) => type==="video/mp4");
  state="inactive"; mimeType:string; onstart:any; onstop:any; ondataavailable:any; onerror:any;
  constructor(public stream:Stream, options?:any) { Recorder.current=this;this.mimeType=options?.mimeType||"video/mp4"; }
  start=vi.fn(() => {this.state="recording";this.onstart?.();});
  stop=vi.fn(() => {this.state="inactive";this.ondataavailable?.({data:new Blob(["real captured fixture bytes"],{type:this.mimeType})});void this.onstop?.();});
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("MediaRecorder",Recorder);vi.stubGlobal("MediaStream",Stream);
  vi.stubGlobal("AudioContext",class { resume=vi.fn(async()=>{});close=vi.fn(async()=>{});createMediaStreamSource(){return { connect:vi.fn(),disconnect:vi.fn() };} createMediaStreamDestination(){return {stream:new Stream([new Track("audio")])};} });
  vi.spyOn(HTMLCanvasElement.prototype,"getContext").mockReturnValue({fillRect:vi.fn(),drawImage:vi.fn()} as any);
  (HTMLCanvasElement.prototype as any).captureStream=vi.fn(()=>new Stream([new Track("video")]));
  vi.spyOn(HTMLMediaElement.prototype,"play").mockResolvedValue();vi.spyOn(HTMLMediaElement.prototype,"pause").mockImplementation(()=>{});
  URL.createObjectURL=vi.fn(()=>"blob:local-recording");URL.revokeObjectURL=vi.fn();
  db.single.mockResolvedValue({data:{id:"recording-row"},error:null}); db.eq.mockResolvedValue({error:null});
  db.upload.mockResolvedValue({error:null});db.signed.mockResolvedValue({data:{signedUrl:"https://example.test/saved.mp4"},error:null});
});
afterEach(() => {cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
const options={applicationId:"application",candidateId:"candidate"};
it("selects a supported format, awaits final upload once, updates by recording ID and keeps owner tracks live", async () => {
  const cam=new Track("video"),mic=new Track("audio"),shared=new Track("video");
  const hook=renderHook(()=>useInterviewRecording(options));
  await act(async()=>{expect(await hook.result.current.startRecording(new Stream([cam,mic]) as any,new Stream([shared]) as any)).toBe(true);});
  expect(Recorder.current.mimeType).toBe("video/mp4"); expect(hook.result.current.isRecording).toBe(true);
  let a!:Promise<string|null>,b!:Promise<string|null>;
  await act(async()=>{a=hook.result.current.stopRecording();b=hook.result.current.stopRecording();await a;});
  expect(a).toBe(b);expect(await a).toBe("https://example.test/saved.mp4");expect(db.upload).toHaveBeenCalledOnce();
  expect(db.upload.mock.calls[0][0]).toMatch(/\.mp4$/);expect(db.upload.mock.calls[0][2].contentType).toBe("video/mp4");
  expect(db.eq).toHaveBeenCalledWith("id","recording-row");expect(hook.result.current.recordingStatus).toBe("ready");
  for(const track of [cam,mic,shared]) expect(track.stop).not.toHaveBeenCalled();
});
it("retains a local copy and reports failure when storage rejects; retries the real upload", async()=>{
  db.upload.mockResolvedValueOnce({error:new Error("Storage file size limit exceeded")});
  const hook=renderHook(()=>useInterviewRecording(options));
  await act(async()=>{await hook.result.current.startRecording(new Stream([new Track("video"),new Track("audio")]) as any);});
  await act(async()=>{expect(await hook.result.current.stopRecording()).toBeNull();});
  expect(hook.result.current.recordingStatus).toBe("failed");expect(hook.result.current.recordingUrl).toBe("blob:local-recording");
  expect(db.update).not.toHaveBeenCalledWith(expect.objectContaining({status:"ready"}));
  await act(async()=>{await hook.result.current.retryUpload();}); expect(hook.result.current.recordingStatus).toBe("ready");
});
it("does not mark a partial capture as a complete recording",async()=>{
  const hook=renderHook(()=>useInterviewRecording(options));
  await act(async()=>{await hook.result.current.startRecording(new Stream([new Track("video"),new Track("audio")]) as any);});
  await act(async()=>{Recorder.current.onerror({error:new Error("Device capture failed")});await hook.result.current.stopRecording();});
  expect(hook.result.current.recordingStatus).toBe("failed"); expect(db.update).toHaveBeenCalledWith(expect.objectContaining({status:"failed"}));
});
