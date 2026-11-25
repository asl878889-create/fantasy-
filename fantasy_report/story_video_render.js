// 聯盟連載影片的畫面：讀 story_video.py 產生的 timeline.json，用無頭瀏覽器一格一格畫（1080×1920 直式），交給 ffmpeg 合成 mp4。
// 用法：node fantasy_report/story_video_render.js <工作資料夾> <輸出.mp4>   （一般由 story_video.py 呼叫）
const { chromium } = require("playwright");
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const [work, out] = process.argv.slice(2);
const TL = JSON.parse(fs.readFileSync(path.join(work, "timeline.json"), "utf8"));
const W = 1080, H = 1920, FPS = TL.fps || 24, N = Math.ceil(TL.total * FPS);
const WORKERS = Math.max(1, Math.min(6, os.cpus().length - 1));

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:#07060c;font-family:"WenQuanYi Zen Hei","Noto Sans CJK TC",sans-serif;color:#f5f1e6}
#bg{position:absolute;inset:0}
.fog{position:absolute;border-radius:50%;filter:blur(90px);opacity:.55}
.ember{position:absolute;width:8px;height:8px;border-radius:50%;background:#ffd89a;box-shadow:0 0 14px 4px rgba(255,190,90,.6)}
#vig{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 45%,transparent 45%,rgba(0,0,0,.75) 100%)}
#hdr{position:absolute;top:70px;left:0;right:0;text-align:center;font-size:34px;letter-spacing:8px;color:rgba(245,230,200,.75)}
#hdr b{color:#f3d58a;font-weight:normal}
.scene{position:absolute;inset:0}
.shield{position:absolute;left:50%;top:330px;width:440px;height:520px;margin-left:-220px}
.shield svg{width:100%;height:100%;filter:drop-shadow(0 0 40px var(--c))}
.tname{position:absolute;top:880px;left:0;right:0;text-align:center;font-size:58px;letter-spacing:6px;color:var(--c);text-shadow:0 0 24px rgba(0,0,0,.9)}
.stat{position:absolute;top:1010px;left:60px;right:60px;text-align:center}
.stat .big{font-size:170px;font-weight:bold;letter-spacing:4px;color:#fff;text-shadow:0 0 40px var(--c),0 6px 0 rgba(0,0,0,.5);line-height:1}
.stat .lab{font-size:46px;color:#f3d58a;margin-top:14px;letter-spacing:3px}
.sub{position:absolute;left:70px;right:70px;top:1420px;min-height:330px;padding:44px 50px;border-radius:28px;background:linear-gradient(180deg,rgba(10,8,18,.55),rgba(10,8,18,.85));border:2px solid rgba(243,213,138,.35);font-size:58px;line-height:1.55;letter-spacing:2px}
.sub .h{opacity:.12}
.ttl{position:absolute;left:0;right:0;text-align:center}
.board,.stand,.next{position:absolute;left:70px;right:70px}
.bh{font-size:78px;text-align:center;color:#f3d58a;letter-spacing:10px;text-shadow:0 0 30px rgba(243,180,80,.6)}
.mrow{margin-top:40px;padding:28px 36px;border-radius:24px;background:rgba(12,10,22,.72);border:2px solid rgba(255,255,255,.08)}
.mt{display:flex;justify-content:space-between;align-items:center;font-size:48px}
.mt .s{font-size:64px;font-weight:bold;min-width:180px;text-align:center}
.bar{height:16px;border-radius:8px;margin-top:20px;display:flex;overflow:hidden;background:rgba(255,255,255,.08)}
.win{color:#fff;text-shadow:0 0 18px var(--c)} .lose{opacity:.55}
.crown{font-size:34px;padding:4px 14px;border-radius:12px;background:#f3d58a;color:#2a1d05;margin-left:12px;vertical-align:middle}
.srow{display:flex;align-items:center;gap:26px;margin-top:22px;padding:20px 30px;border-radius:20px;background:rgba(12,10,22,.72);font-size:46px}
.rk{width:64px;text-align:center;font-size:54px;color:#f3d58a;font-weight:bold}
.gl{width:84px;height:84px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:46px;color:#120d05;font-weight:bold;flex:none}
.nm{flex:1} .rc{font-size:50px;font-weight:bold;min-width:120px;text-align:right}
.chg{font-size:36px;min-width:80px;text-align:right} .up{color:#7bd389} .dn{color:#ef476f}
.stk{font-size:30px;padding:4px 12px;border-radius:10px;background:rgba(255,255,255,.12);margin-left:12px}
.vs{display:flex;align-items:center;justify-content:center;gap:34px;margin-top:46px;font-size:46px}
.vs .x{color:#f3d58a;font-size:40px}
.vs .side{display:flex;align-items:center;gap:20px;width:390px} .vs .side.r{justify-content:flex-end}
</style></head><body><div id="bg"></div><div id="vig"></div><div id="hdr"></div><div id="stage"></div>
<script>
const TL = ${JSON.stringify(TL)};
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x)), ease=(x)=>1-Math.pow(1-clamp(x),3), esc=(s)=>String(s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"})[c]);
const rnd=(i)=>{const x=Math.sin(i*127.1+311.7)*43758.5453;return x-Math.floor(x)};
const bg=document.getElementById("bg"), stage=document.getElementById("stage"), hdr=document.getElementById("hdr");
// 背景：三團霧和 36 顆火星
bg.innerHTML='<div class="fog" id="f1"></div><div class="fog" id="f2"></div><div class="fog" id="f3"></div>'+Array.from({length:36},(_,i)=>'<i class="ember" id="e'+i+'"></i>').join("");
function shield(c,g){return '<svg viewBox="0 0 220 260"><defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="'+c+'"/><stop offset="1" stop-color="#140f1c"/></linearGradient></defs>'+
 '<path d="M110 8 L206 40 L198 140 C190 200 150 236 110 252 C70 236 30 200 22 140 L14 40 Z" fill="url(#sg)" stroke="#f3d58a" stroke-width="6"/>'+
 '<path d="M110 30 L186 55 L180 138 C174 186 144 214 110 228 C76 214 46 186 40 138 L34 55 Z" fill="none" stroke="rgba(243,213,138,.45)" stroke-width="3"/>'+
 '<text x="110" y="160" text-anchor="middle" font-size="'+(g.length>1?70:110)+'" fill="#fff8e6" font-family="WenQuanYi Zen Hei" font-weight="bold">'+esc(g)+'</text></svg>'}
let built=null;
function sceneAt(t){return TL.scenes.find(s=>t>=s.start&&t<s.start+s.dur)||TL.scenes[TL.scenes.length-1]}
function build(s){
  if(s.type==="title") return '<div class="ttl" style="top:560px"><div id="t1" style="font-size:150px;letter-spacing:24px;color:#f3d58a;text-shadow:0 0 60px rgba(243,180,80,.8)">'+esc(s.series)+'</div>'+
    '<div id="t2" style="margin-top:90px;font-size:60px;letter-spacing:14px">第 '+s.no+' 章</div><div id="t3" style="margin-top:40px;font-size:96px;letter-spacing:8px">'+esc(s.title)+'</div>'+
    '<div id="t4" style="margin-top:70px;font-size:40px;color:rgba(245,230,200,.7);letter-spacing:6px">第 '+s.week+' 週　'+esc(s.dates)+'</div></div>';
  if(s.type==="board") return '<div class="board" style="top:190px"><div class="bh">第 '+s.week+' 週戰報</div>'+s.ms.map((m,i)=>'<div class="mrow" id="m'+i+'">'+
    '<div class="mt"><span class="'+(m.wa?"win":"lose")+'" style="--c:'+m.ca+'">'+esc(m.a)+(m.wa?'<span class="crown">勝</span>':'')+'</span><span class="'+(m.wb?"win":"lose")+'" style="--c:'+m.cb+'">'+(m.wb?'<span class="crown" style="margin:0 12px 0 0">勝</span>':'')+esc(m.b)+'</span></div>'+
    '<div class="mt" style="margin-top:6px"><span class="s '+(m.wa?"win":"lose")+'" style="--c:'+m.ca+';text-align:left" id="sa'+i+'">0</span><span style="font-size:34px;color:#f3d58a">VS</span><span class="s '+(m.wb?"win":"lose")+'" style="--c:'+m.cb+';text-align:right" id="sb'+i+'">0</span></div>'+
    '<div class="bar"><i id="ba'+i+'" style="background:'+m.ca+';width:50%"></i><i id="bb'+i+'" style="background:'+m.cb+';width:50%"></i></div></div>').join("")+'</div>';
  if(s.type==="standings") return '<div class="stand" style="top:200px"><div class="bh" style="margin-bottom:30px">第 '+s.week+' 週後排名</div>'+s.rows.map((r,i)=>'<div class="srow" id="r'+i+'"><span class="rk">'+r.rank+'</span><span class="gl" style="background:'+r.color+'">'+esc(r.glyph)+'</span><span class="nm">'+esc(r.name)+(r.streak?'<span class="stk">'+esc(r.streak)+'</span>':'')+'</span>'+
    '<span class="chg '+(r.chg>0?"up":r.chg<0?"dn":"")+'">'+(r.chg>0?"▲"+r.chg:r.chg<0?"▼"+(-r.chg):"")+'</span><span class="rc">'+esc(r.rec)+'</span></div>').join("")+'</div>';
  if(s.type==="end") return '<div class="next" style="top:330px"><div class="bh">下週對戰</div>'+s.next.map((m,i)=>'<div class="vs" id="v'+i+'"><span class="side r">'+esc(m.a)+'<span class="gl" style="background:'+m.ca+'">'+esc(m.ga)+'</span></span><span class="x">VS</span><span class="side"><span class="gl" style="background:'+m.cb+'">'+esc(m.gb)+'</span>'+esc(m.b)+'</span></div>').join("")+
    '<div id="tbc" style="margin-top:150px;text-align:center;font-size:84px;letter-spacing:20px;color:#f3d58a;text-shadow:0 0 40px rgba(243,180,80,.7)">未完待續</div></div>';
  return '<div id="pa"></div>';
}
let lastSub=null, lastTeam=null, teamT=0;
function seek(t){
  const s=sceneAt(t), lt=t-s.start, p=lt/s.dur;
  if(built!==s){built=s;stage.innerHTML='<div class="scene" id="sc">'+build(s)+'</div>';lastSub=null}
  const sc=document.getElementById("sc");
  sc.style.opacity=String(clamp(lt/0.45)*clamp((s.dur-lt)/0.45));
  let col="#b08a4a";
  hdr.innerHTML=s.type==="title"?"":'<b>'+esc(TL.scenes[0].series)+'</b>　第 '+TL.scenes[0].no+' 章　'+esc(TL.scenes[0].title);
  if(s.type==="title"){["t1","t2","t3","t4"].forEach((id,i)=>{const e=document.getElementById(id),k=ease((lt-0.3-i*0.45)/0.9);e.style.opacity=k;e.style.transform="translateY("+(40*(1-k))+"px) scale("+(i==0?1+0.03*Math.sin(t):1)+")"});col="#c8862e"}
  if(s.type==="board"){s.ms.forEach((m,i)=>{const k=ease((lt-0.4-i*0.35)/1.2),e=document.getElementById("m"+i);e.style.opacity=clamp((lt-0.2-i*0.35)/0.4);e.style.transform="translateX("+(80*(1-clamp((lt-0.2-i*0.35)/0.5)))+"px)";
    document.getElementById("sa"+i).textContent=Math.round(m.sa*k);document.getElementById("sb"+i).textContent=Math.round(m.sb*k);
    const fa=m.sa/(m.sa+m.sb);document.getElementById("ba"+i).style.width=(50+(fa*100-50)*k)+"%";document.getElementById("bb"+i).style.width=(50-(fa*100-50)*k)+"%"});col="#8a5a2e"}
  if(s.type==="standings"){s.rows.forEach((r,i)=>{const e=document.getElementById("r"+i),k=ease((lt-0.3-i*0.18)/0.6);e.style.opacity=k;e.style.transform="translateX("+(-120*(1-k))+"px)"});col="#4a3a7a"}
  if(s.type==="end"){s.next.forEach((m,i)=>{const e=document.getElementById("v"+i),k=ease((lt-0.3-i*0.3)/0.7);e.style.opacity=k;e.style.transform="scale("+(0.85+0.15*k)+")"});const e=document.getElementById("tbc"),k=ease((lt-2.2)/1.2);e.style.opacity=k*(0.85+0.15*Math.sin(t*3));col="#6a2a3a"}
  if(s.type==="para"){
    const sub=s.subs.find(x=>t>=x.start&&t<x.start+x.dur)||s.subs[s.subs.length-1], st=t-sub.start;
    const tm=sub.team; col=tm?tm.color:"#b08a4a";
    if(sub!==lastSub){lastSub=sub;const tk=tm?tm.name:"";if(tk!==lastTeam){lastTeam=tk;teamT=sub.start}
      const stat=sub.stat;let sh="";
      if(stat&&stat.kind==="score")sh='<div class="big" id="sv" style="font-size:124px;white-space:nowrap" data-a="'+stat.a+'" data-b="'+stat.b+'">0 : 0</div><div class="lab">比分</div>';
      else if(stat&&stat.kind==="player")sh='<div class="big" id="sv" data-v="'+stat.v+'">0</div><div class="lab">'+esc(stat.name)+'　戰功</div>';
      else if(stat&&stat.kind==="team")sh='<div class="big" id="sv" data-v="'+stat.v+'">0</div><div class="lab">本週總戰功</div>';
      else if(stat&&stat.kind==="gap")sh='<div class="big" id="sv" data-v="'+stat.v+'">0</div><div class="lab">分差</div>';
      document.getElementById("pa").innerHTML=(tm?'<div class="shield" id="sh" style="--c:'+tm.color+'">'+shield(tm.color,tm.glyph)+'</div><div class="tname" id="tn" style="--c:'+tm.color+'">'+esc(tm.name)+'</div>':
        '<div class="shield" id="sh" style="--c:#f3d58a">'+shield("#7a5a2a","戰")+'</div>')+(sh?'<div class="stat" id="stb" style="--c:'+col+'">'+sh+'</div>':'')+
        '<div class="sub" id="sb">'+[...sub.text].map((c,i)=>'<span id="c'+i+'">'+esc(c)+'</span>').join("")+'</div>'}
    const ek=ease((t-teamT)/0.6), shd=document.getElementById("sh");
    const hasStat=!!document.getElementById("stb");
    shd.style.transform="translateY("+(hasStat?-60:0)+"px) scale("+((hasStat?0.78:1)*(0.7+0.3*ek)+0.015*Math.sin(t*1.6))+")";shd.style.opacity=ek;
    const tn=document.getElementById("tn");if(tn){tn.style.opacity=ek;tn.style.transform="translateY("+(hasStat?-110:0)+"px)"}
    if(hasStat){const sv=document.getElementById("sv"),k=ease((st-0.25)/0.9);document.getElementById("stb").style.opacity=clamp((st-0.15)/0.3);
      sv.textContent=sv.dataset.a?Math.round(sv.dataset.a*k)+" : "+Math.round(sv.dataset.b*k):String(Math.round(sv.dataset.v*k));sv.style.transform="scale("+(1+0.25*(1-clamp((st-0.15)/0.4)))+")"}
    const n=sub.text.length, shown=Math.floor(n*clamp(st/Math.max(0.5,(sub.dur-0.35)*0.92)));
    for(let i=0;i<n;i++){const e=document.getElementById("c"+i);if(e)e.className=i<shown?"":"h"}
    document.getElementById("sb").style.opacity=String(clamp(st/0.2)+0.0);
  }
  // 背景跟著主角城的顏色
  document.body.style.background="radial-gradient(ellipse at 50% 38%,"+col+"55 0%,#0b0814 55%,#05040a 100%)";
  const f=[["f1",0.07,520,"#"],["f2",0.05,640,""],["f3",0.09,420,""]];
  f.forEach(([id,sp,sz],i)=>{const e=document.getElementById(id);e.style.width=e.style.height=sz+"px";e.style.background=i==1?"#3a2a6e":col;
    e.style.left=(540-sz/2+300*Math.sin(t*sp+i*2))+"px";e.style.top=(600+i*420-sz/2+160*Math.cos(t*sp*1.3+i))+"px"});
  for(let i=0;i<36;i++){const e=document.getElementById("e"+i),sp=40+rnd(i)*70,y=(${H}+100-((t*sp+rnd(i+50)*${H})%(${H}+200))),x=rnd(i+9)*${W}+40*Math.sin(t*0.7+i);
    e.style.transform="translate("+x+"px,"+y+"px) scale("+(0.5+rnd(i+3))+")";e.style.opacity=String(0.25+0.5*rnd(i+7))}
}
window.seek=seek;
</script></body></html>`;

(async () => {
  const html = path.join(work, "page.html"); fs.writeFileSync(html, PAGE);
  const browser = await chromium.launch();
  if (process.env.PREVIEW) { // 測試用：只畫幾個時間點的畫面，例如 PREVIEW=1,10,30
    const page = await browser.newPage({ viewport: { width: W, height: H } }); await page.goto("file://" + html);
    for (const t of process.env.PREVIEW.split(",").map(Number)) { await page.evaluate((t) => window.seek(t), t); await page.screenshot({ path: path.join(work, `preview-${t}.png`) }); }
    await browser.close(); return;
  }
  const seg = Math.ceil(N / WORKERS);
  console.error(`畫 ${N} 格（${TL.total.toFixed(1)} 秒），${WORKERS} 個同時…`);
  let done = 0;
  await Promise.all(Array.from({ length: WORKERS }, async (_, w) => {
    const a = w * seg, b = Math.min(N, a + seg); if (a >= b) return;
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    await page.goto("file://" + html); await page.waitForTimeout(300);
    const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", path.join(work, `seg${w}.mp4`)], { stdio: ["pipe", "inherit", "inherit"] });
    for (let i = a; i < b; i++) {
      await page.evaluate((t) => window.seek(t), i / FPS);
      const buf = await page.screenshot({ type: "jpeg", quality: 90 });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
      if (++done % 500 === 0) console.error(`  ${done}/${N}`);
    }
    ff.stdin.end(); await new Promise((r) => ff.on("close", r)); await page.close();
  }));
  await browser.close();
  const list = path.join(work, "segs.txt");
  fs.writeFileSync(list, Array.from({ length: WORKERS }, (_, w) => w).filter((w) => fs.existsSync(path.join(work, `seg${w}.mp4`))).map((w) => `file 'seg${w}.mp4'`).join("\n"));
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-i", path.join(work, "audio.wav"), "-c:v", "copy", "-af", "loudnorm=I=-16:TP=-1.5", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", path.resolve(out)]);
  console.error("完成：", out);
})().catch((e) => { console.error(e); process.exit(1); });
