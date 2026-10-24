import express from "express";
import multer from "multer";
import Groq from "groq-sdk";
import dotenv from "dotenv";
import { applyComposition } from "./lib/apply-composition.mjs";
import { parseStyleProfile } from "./lib/style-profile.mjs";
import { videoResponse, localRequests, exclusiveApply } from "./lib/safety.mjs";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({path:path.join(root,".env"),quiet:true});
export const app = express();
const port = Number(process.env.PORT || 4173);
const limit = Number(process.env.MAX_VIDEO_BYTES || 209715200);
if (!Number.isSafeInteger(limit) || limit < 1) throw Error("MAX_VIDEO_BYTES must be a positive integer.");
if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error("PORT must be a valid port number.");
// HyperFrames Studio lints every .html outside dot-folders as a sub-composition. Only index.html (and compositions/)
// are real compositions, so generated previews live in .generated/, the studio page in .studio/, and composition
// backups are saved as *.html.bak. Keep it that way or lint reports hundreds of false findings.
const dirs = Object.fromEntries([["uploads","uploads"],["generated",".generated"],["backups","backups"],["renders","renders"]].map(([n,d]) => [n,path.join(root,d)]));
const studioDir = path.join(root,".studio");
const groq = process.env.GROQ_API_KEY ? new Groq({apiKey:process.env.GROQ_API_KEY}) : null;
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg", ffprobe = process.env.FFPROBE_PATH || "ffprobe";
await Promise.all(Object.values(dirs).map(d=>fs.mkdir(d,{recursive:true})));
const upload = multer({storage:multer.diskStorage({destination:(_r,_f,cb)=>cb(null,dirs.uploads),filename:(_r,f,cb)=>cb(null,Date.now()+"-"+randomUUID()+"-"+path.basename(f.originalname).replace(/[^\w.-]/g,"_").slice(-80))}),limits:{fileSize:limit,files:2},fileFilter:(_r,f,cb)=>/^video\//i.test(f.mimetype)||/\.(mp4|webm|mov|mkv|mpeg|mpg|ogv)$/i.test(f.originalname)?cb(null,true):cb(new Error("Use MP4, WebM, MOV, MKV, MPEG, or OGV video."))});
app.disable("x-powered-by");app.use(localRequests);app.use(express.json({limit:"1mb"}));
app.use((_q,s,n)=>{s.setHeader("X-Content-Type-Options","nosniff");s.setHeader("Referrer-Policy","no-referrer");n()});
function run(cmd,args){return new Promise((resolve,reject)=>{const p=spawn(cmd,args,{windowsHide:true});let out="",err="";p.stdout.on("data",x=>out+=x);p.stderr.on("data",x=>err+=x);p.on("error",e=>reject(new Error("Cannot start "+cmd+": "+e.message)));p.on("close",c=>c===0?resolve(out):reject(new Error(cmd+" failed: "+err.slice(-700))))})}
function runHyperframes(args){return new Promise((resolve,reject)=>{const command=process.platform==="win32"?"cmd.exe":"npx";const commandArgs=process.platform==="win32"?["/d","/s","/c","npx --yes hyperframes@0.8.186 "+args.join(" ")]:["--yes","hyperframes@0.8.186",...args];const p=spawn(command,commandArgs,{windowsHide:true,cwd:root});let out="",err="";p.stdout.on("data",x=>out+=x);p.stderr.on("data",x=>err+=x);p.on("error",e=>reject(new Error("Cannot start HyperFrames: "+e.message)));p.on("close",c=>c===0?resolve(out+"\\n"+err):reject(new Error("HyperFrames "+args[0]+" failed: "+(err||out).slice(-1800))))})}
async function download(raw,label){
  let url = new URL(raw), response;
  for(let i=0;i<=3;i++){
    response = await videoResponse(url);
    if(![301,302,303,307,308].includes(response.statusCode)) break;
    const location = response.headers.location;
    response.destroy();
    if(!location || i===3) throw Error("Too many redirects.");
    url = new URL(location,url);
  }
  const type = String(response.headers["content-type"]||"").toLowerCase();
  if(response.statusCode < 200 || response.statusCode >= 300 ||
    (!type.startsWith("video/") && !/\.(mp4|webm|mov|mkv|mpeg|mpg|ogv)$/i.test(url.pathname)) ||
    Number(response.headers["content-length"]||0)>limit){
    response.destroy();
    throw Error("URL must be a direct video file within the size limit.");
  }
  const file=path.join(dirs.uploads,randomUUID()+"-"+label+".mp4");
  let fd, size=0;
  try{
    fd=await fs.open(file,"wx");
    for await(const chunk of response){
      size+=chunk.byteLength;
      if(size>limit) throw Error("Video exceeds the size limit.");
      let offset=0;
      while(offset<chunk.length){const {bytesWritten}=await fd.write(chunk,offset);offset+=bytesWritten;}
    }
    if(!size) throw Error("Video is empty.");
    await fd.close();fd=null;
    return {path:file,originalname:path.basename(url.pathname)||label};
  }catch(e){
    response.destroy();
    if(fd) await fd.close().catch(()=>{});
    await fs.unlink(file).catch(()=>{});
    throw e;
  }
}
async function probe(file){const data=JSON.parse(await run(ffprobe,["-v","error","-show_entries","format=duration,size,format_name:stream=codec_type,codec_name,width,height,r_frame_rate","-of","json",file]));const v=(data.streams||[]).find(x=>x.codec_type==="video");if(!v)throw Error("No readable video stream found.");if(!Number.isFinite(+data.format?.duration)||+data.format.duration<=0)throw Error("Video must have a finite positive duration.");return {hasAudio:(data.streams||[]).some(stream=>stream.codec_type==="audio"),duration:+(data.format?.duration||0),size:+(data.format?.size||0),format:data.format?.format_name||"",width:+(v.width||0),height:+(v.height||0),codec:v.codec_name||"",frameRate:v.r_frame_rate||""}}
async function sample(file,duration){const d=await fs.mkdtemp(path.join(os.tmpdir(),"style-"));try{const a=[];for(const [i,f] of [0.1,0.5,0.9].entries()){const at=Math.max(0,Math.min(Math.max(0,duration-.1),duration*f)),p=path.join(d,i+".jpg");await run(ffmpeg,["-hide_banner","-loglevel","error","-ss",String(at),"-i",file,"-frames:v","1","-vf","scale=768:-2","-q:v","5","-y",p]);a.push({time:+at.toFixed(2),url:"data:image/jpeg;base64,"+(await fs.readFile(p)).toString("base64")})}return a}finally{await fs.rm(d,{recursive:true,force:true})}}
async function transcribe(file){if(!groq||(await fs.stat(file)).size>24*1024*1024)return{text:"",segments:[]};try{const t=await groq.audio.transcriptions.create({file:createReadStream(file),model:process.env.GROQ_TRANSCRIPTION_MODEL||"whisper-large-v3-turbo",response_format:"verbose_json",timestamp_granularities:["segment"]});return{text:t.text||"",segments:(t.segments||[]).map(s=>({start:+s.start,end:+s.end,text:String(s.text||"").trim()}))}}catch{return{text:"",segments:[]}}}
async function analyze(meta,frames,transcript){const prompt='Analyze sampled frames from a short-form reference video. Return ONLY JSON: {"summary":"string","platform":"TikTok|YouTube Shorts|Instagram Reels|General short-form","aspectRatio":"9:16|16:9|1:1|4:5","editingPace":"slow|moderate|fast|very fast","averageShotLengthSeconds":number,"visualStyle":{"palette":["color"],"contrast":"string","lighting":"string","texture":"string"},"captionStyle":{"enabled":true,"position":"top|center|lower-third|bottom","case":"string","fontWeight":"string","highlighting":"string","maxWordsPerLine":number,"notes":"string"},"transitions":["string"],"motion":{"punchIns":true,"zoomFrequency":"string","cameraMovement":"string"},"soundDesign":{"music":"string","effects":["string"],"voiceover":true},"structure":[{"phase":"string","approxStartSeconds":0,"purpose":"string"}],"replicationPlan":["string"],"confidenceNotes":["string"]}. Do not invent details. Metadata '+JSON.stringify(meta)+'; transcript '+(transcript.text||"unavailable")+'. Sample times '+frames.map(f=>f.time).join(", ")+' seconds.';const r=await groq.chat.completions.create({model:process.env.GROQ_VISION_MODEL||"qwen/qwen3.8-27b",temperature:.2,max_completion_tokens:1600,response_format:{type:"json_object"},messages:[{role:"user",content:[{type:"text",text:prompt},...frames.map(f=>({type:"image_url",image_url:{url:f.url}}))]}]});const text=r.choices?.[0]?.message?.content||"{}",a=text.indexOf("{"),b=text.lastIndexOf("}");if(a<0||b<=a)throw Error("Groq did not return a JSON style profile.");return parseStyleProfile(JSON.parse(text.slice(a,b+1)))}
const esc=v=>String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function makeHtml(src,meta,style,transcript){const duration=Math.max(0.1,Number(meta.duration)||15),pace=style.editingPace==="very fast"?1.5:style.editingPace==="fast"?2.4:style.editingPace==="slow"?5:3.5,count=Math.max(1,Math.ceil(duration/pace)),segments=(Array.isArray(transcript.segments)?transcript.segments:[]).flatMap(segment=>{const words=String(segment.text||"").trim().split(/\s+/),groups=[];if(words.length<=6)return [segment];for(let i=0;i<words.length;i+=6){const start=Number(segment.start),length=Number(segment.end)-start;groups.push({start:start+length*i/words.length,end:start+length*Math.min(i+6,words.length)/words.length,text:words.slice(i,i+6).join(" ")})}return groups}),portrait=style.aspectRatio==="9:16"||(!style.aspectRatio&&["TikTok","YouTube Shorts","Instagram Reels"].includes(style.platform)),w=style.aspectRatio==="1:1"?1080:style.aspectRatio==="4:5"?1080:portrait?1080:1920,h=style.aspectRatio==="1:1"?1080:style.aspectRatio==="4:5"?1350:portrait?1920:1080,color=(Array.isArray(style.visualStyle?.palette)?style.visualStyle.palette:[]).some(x=>/yellow|gold/i.test(x))?"#ffe45e":"#fff";const cuts=Array.from({length:count},(_,i)=>{const start=duration*i/count,end=duration*(i+1)/count;return{start,len:end-start}});const clips=cuts.map((c,i)=>'<video id="shot-'+i+'" class="clip shot footage" data-hf-id="shot-'+i+'" data-start="'+c.start.toFixed(3)+'" data-duration="'+c.len.toFixed(3)+'" data-media-start="'+c.start.toFixed(3)+'" data-track-index="0" src="'+esc(src)+'" muted playsinline preload="auto"></video>').join("");const captions=style.captionStyle?.enabled===false?"":segments.map((segment,i)=>{const start=Math.max(0,Number(segment.start)),end=Math.min(duration,Number(segment.end)),text=String(segment.text||"").trim();if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||!text)return "";return '<div id="caption-'+i+'" class="clip caption" data-hf-id="caption-'+i+'" data-start="'+start.toFixed(3)+'" data-duration="'+(end-start).toFixed(3)+'" data-track-index="1">'+esc(text)+'</div>'}).join("");const anim=style.motion?.punchIns===false?"":cuts.map((c,i)=>'tl.fromTo("#shot-'+i+'",{scale:1},{scale:'+(i%3===1?1.12:1.04)+',duration:'+Math.min(.45,c.len/3)+',ease:"power2.out"},'+c.start+');').join("");return '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width='+w+',height='+h+'"><script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script><style>:root{--caption:'+color+'}*{box-sizing:border-box}html,body{margin:0;width:'+w+'px;height:'+h+'px;overflow:hidden;background:#080808;font-family:Arial,sans-serif}#root{position:relative;width:100%;height:100%;overflow:hidden}.shot{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#111}.footage{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.caption{position:absolute;z-index:2;left:10%;right:10%;bottom:16%;text-align:center;color:var(--caption);font-size:'+(portrait?64:74)+'px;line-height:1.04;font-weight:900;text-transform:uppercase;letter-spacing:-.035em;text-shadow:0 3px 14px #000,2px 2px 0 #000}</style></head><body><div id="root" data-hf-id="root" data-composition-id="main" data-start="0" data-duration="'+duration+'" data-width="'+w+'" data-height="'+h+'">'+clips+captions+(meta.hasAudio===false?'':'<audio id="source-audio" class="clip" data-hf-id="source-audio" data-start="0" data-duration="'+duration+'" data-media-start="0" data-track-index="2" data-volume="1" src="'+esc(src)+'" preload="auto"></audio>')+'</div><script>window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});'+anim+'window.__timelines["main"]=tl;tl.seek(0);</script></body></html>'}
function videoExtension(file){const ext=path.extname(file).toLowerCase();return /^\.(mp4|webm|mov|mkv|mpeg|mpg|ogv)$/.test(ext)?ext:".mp4"}
async function clean(f){if(f?.path&&f.path.startsWith(dirs.uploads)&&!f.keep)await fs.unlink(f.path).catch(()=>{})}
app.get("/api/health",async(_q,s)=>{let f=false,p=false;try{await run(ffmpeg,["-version"]);f=true}catch{}try{await run(ffprobe,["-version"]);p=true}catch{}s.json({ok:true,groqConfigured:!!groq,ffmpegAvailable:f,ffprobeAvailable:p,maxVideoBytes:limit})});
app.post("/api/analyze",upload.fields([{name:"referenceVideo",maxCount:1},{name:"sourceVideo",maxCount:1}]),async(q,s)=>{let ref=q.files?.referenceVideo?.[0],src=q.files?.sourceVideo?.[0];const created=[];let completed=false;try{if(!groq)throw Error("GROQ_API_KEY is missing. Copy .env.example to .env and add your key.");if(!ref&&!q.body.referenceUrl)throw Error("Add a reference video or direct HTTPS URL.");if(!src&&!q.body.sourceUrl)throw Error("Add your footage or direct HTTPS URL.");if(!ref)ref=await download(q.body.referenceUrl,"reference");if(!src)src=await download(q.body.sourceUrl,"source");const [rm,sm]=await Promise.all([probe(ref.path),probe(src.path)]);let fr;try{fr=await sample(ref.path,rm.duration)}catch(e){throw Error("FFmpeg is required to sample frames. Install FFmpeg/FFprobe or set their paths in .env. "+e.message)}const rt=await transcribe(ref.path),style=await analyze(rm,fr,rt),st=await transcribe(src.path),id=randomUUID(),rn=id+"-reference"+videoExtension(ref.originalname||ref.path),sn=id+"-source"+videoExtension(src.originalname||src.path);created.push(path.join(dirs.uploads,rn),path.join(dirs.uploads,sn),path.join(dirs.generated,id+"-analysis.json"),path.join(dirs.generated,id+"-composition.html"));await fs.copyFile(ref.path,path.join(dirs.uploads,rn));await fs.copyFile(src.path,path.join(dirs.uploads,sn));const result={id,createdAt:new Date().toISOString(),reference:{file:rn,metadata:rm,transcript:rt.text},source:{file:sn,metadata:sm,transcript:st.text,transcriptSegments:st.segments},styleProfile:style,notes:["Analysis uses sampled frames and may miss between-frame edits.","Review captions, timings, and usage rights before publishing."]};await fs.writeFile(path.join(dirs.generated,id+"-analysis.json"),JSON.stringify(result,null,2));await fs.writeFile(path.join(dirs.generated,id+"-composition.html"),makeHtml("../uploads/"+sn,sm,style,st));completed=true;s.json({...result,compositionUrl:"/generated/"+id+"-composition.html",analysisUrl:"/generated/"+id+"-analysis.json"})}catch(e){s.status(400).json({error:e.message||"Analysis failed."})}finally{await clean(ref);await clean(src);if(!completed)await Promise.all(created.map(file=>fs.unlink(file).catch(()=>{})))}});
app.post("/api/apply",exclusiveApply(),async(q,s)=>{
  try {
    const result = await applyComposition({root,dirs,id:String(q.body?.id||""),runHyperframes});
    s.json(result);
  } catch(error) {
    s.status(400).json({error:error.message||"Could not apply composition."});
  } finally {
    s.locals.releaseApply();
  }
});app.use("/uploads",express.static(dirs.uploads,{dotfiles:"deny",index:false,setHeaders:r=>r.setHeader("Cache-Control","no-store")}));app.use("/generated",express.static(dirs.generated,{dotfiles:"deny",index:false}));app.use("/renders",express.static(dirs.renders,{dotfiles:"deny",index:false}));app.get("/index.html",(_q,s)=>s.sendFile("index.html",{root}));app.get("/",(_q,s)=>s.sendFile("studio.html",{root:studioDir}));app.use((e,_q,s,_n)=>s.status(400).json({error:e.message||"Request failed."}));
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) app.listen(port,"127.0.0.1",()=>console.log("AI Reference Video Style Studio at http://127.0.0.1:"+port+" (localhost only)"));
