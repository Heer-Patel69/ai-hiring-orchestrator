import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VideoPanel } from "./VideoPanel";
vi.mock("framer-motion", () => ({ motion: { div: ({ children }: any) => <div>{children}</div> }, AnimatePresence: ({ children }: any) => children }));
class Track extends EventTarget { kind: string; readyState="live"; enabled=true; muted=false; stop=vi.fn(() => { this.readyState="ended"; }); constructor(kind:string){ super();this.kind=kind; } }
class Stream { tracks:Track[]; constructor(tracks:Track[]){this.tracks=tracks;} getTracks(){return this.tracks;} getVideoTracks(){return this.tracks.filter(t=>t.kind==="video");} getAudioTracks(){return this.tracks.filter(t=>t.kind==="audio");} }
const props={isRecording:false, elapsedTime:0, remainingTime:500, aiSpeaking:false};
let getUserMedia: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal("MediaStream", Stream); getUserMedia=vi.fn();
  Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{getUserMedia,addEventListener:vi.fn(),removeEventListener:vi.fn()}});
  vi.spyOn(HTMLMediaElement.prototype,"play").mockResolvedValue();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("keeps borrowed camera/mic tracks alive across rerenders and unmount", () => {
  const cam=new Track("video"), mic=new Track("audio"), stream=new Stream([cam,mic]);
  const view=render(<VideoPanel {...props} mediaStream={stream as any} />);
  view.rerender(<VideoPanel {...props} elapsedTime={42} mediaStream={stream as any} />);
  expect(getUserMedia).not.toHaveBeenCalled(); expect(view.container.querySelector("video")!.srcObject).toBe(stream);
  view.unmount(); expect(cam.stop).not.toHaveBeenCalled(); expect(mic.stop).not.toHaveBeenCalled();
});
it("recovers only camera video, preserves microphone, and publishes the replacement stream to its owner", async () => {
  const cam=new Track("video"), mic=new Track("audio"), recovered=new Track("video"), onRecovered=vi.fn();
  getUserMedia.mockResolvedValue(new Stream([recovered]));
  const view=render(<VideoPanel {...props} mediaStream={new Stream([cam,mic]) as any} onStreamRecovered={onRecovered} />);
  await act(async () => { cam.readyState="ended"; cam.dispatchEvent(new Event("ended")); });
  expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({audio:false}));
  const replacement=onRecovered.mock.calls[0][0]; expect(replacement.getAudioTracks()).toEqual([mic]);
  expect(view.container.querySelector("video")!.srcObject).toBe(replacement); expect(mic.stop).not.toHaveBeenCalled();
});
it("cleans a stream which resolves after unmount", async () => {
  let resolve!: (stream:Stream)=>void; getUserMedia.mockReturnValue(new Promise(r=>{resolve=r;}));
  const view=render(<VideoPanel {...props} />); view.unmount(); const track=new Track("video");
  await act(async () => resolve(new Stream([track]))); expect(track.stop).toHaveBeenCalledOnce();
});
