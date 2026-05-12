// rial-scenes.jsx — Rial Chick wide pixel-art scene
// 16:3 banner. Five vignettes. Animated parallax + characters.

// Mood palettes — each redefines sky + ground tint + navy depth + accent strength.
const MOODS = {
  day: {
    skyA:'#00C2FF', skyB:'#7be0ff', skyC:'#cdf3ff',
    sand1:'#d8b372', sand2:'#c39a55', sand3:'#9c7333',
    nav0:'#0a1430', nav1:'#142547', nav2:'#1f3868', nav3:'#2a4f8c',
    gold:'#F5C518', goldD:'#a87f06', goldL:'#ffe27a',
    cyan:'#00C2FF', cyanD:'#0079a8', cyanL:'#aaeaff',
    glow: 0.6,
    vignette: 0.5,
  },
  sunset: {
    skyA:'#ff8a3a', skyB:'#ffb56a', skyC:'#ffd9a6',
    sand1:'#b87a3a', sand2:'#8c5526', sand3:'#5e3818',
    nav0:'#2a0e2a', nav1:'#3e1538', nav2:'#5b1e4a', nav3:'#7c2a5c',
    gold:'#ffcf3a', goldD:'#a86a06', goldL:'#fff0a0',
    cyan:'#ff7ad1', cyanD:'#a8367a', cyanL:'#ffc9ec',
    glow: 0.8,
    vignette: 0.65,
  },
  neon: {
    skyA:'#0a0420', skyB:'#1a0a3a', skyC:'#2a1056',
    sand1:'#2a1a4a', sand2:'#1a0e36', sand3:'#0e0625',
    nav0:'#000010', nav1:'#0a0530', nav2:'#1a0e54', nav3:'#2a1880',
    gold:'#ffe23a', goldD:'#c89400', goldL:'#fff7a8',
    cyan:'#00f0ff', cyanD:'#00a8c8', cyanL:'#c8faff',
    glow: 1.4,
    vignette: 0.85,
  },
};

const RP_STATIC = {
  track:'#3a3a3a', trackL:'#555', trackEdge:'#f5c518',
  white:'#fff8e7', cream:'#f4ecd6',
  red:'#c84141', redD:'#7a2424',
  metal:'#6c7587', metalD:'#3a4150', metalL:'#aab2c2',
  ink:'#0a0d1c',
  steam:'#e7eef5', steamD:'#bfcad8',
};

const TweakContext = React.createContext({
  mood: 'day',
  density: 'busy',
  camera: 'cinematic',
});
function useTweakValues(){ return React.useContext(TweakContext); }
function useRP(){
  const { mood } = useTweakValues();
  return { ...RP_STATIC, ...MOODS[mood] };
}
// Backward-compat: top-level RP is the day palette so any module-time refs still resolve.
const RP = { ...RP_STATIC, ...MOODS.day };

const RBox = ({x,y,w,h,c,style={}}) => (
  <div style={{position:'absolute', left:x, top:y, width:w, height:h, background:c, ...style}}/>
);

// ── Sky / clouds ─────────────────────────────────────────────────────────
function RSky({worldW, camX, t}){
  const RP = useRP();
  const clouds = [
    {x:200, y:60, w:120, h:22, s:6},
    {x:760, y:40, w:160, h:26, s:5},
    {x:1340,y:80, w:110, h:20, s:7},
    {x:1900,y:50, w:180, h:28, s:5.5},
    {x:2520,y:70, w:140, h:22, s:6.5},
    {x:3180,y:55, w:160, h:24, s:6},
    {x:3820,y:80, w:120, h:22, s:5.8},
    {x:4480,y:48, w:170, h:26, s:6.2},
  ];
  return (
    <>
      {clouds.map((c,i)=>{
        const drift = (t*c.s)%(worldW+300);
        let x = ((c.x - drift)%(worldW+300)+(worldW+300))%(worldW+300)-150;
        x = x - camX*0.35;
        return (
          <div key={i} style={{position:'absolute', left:x, top:c.y}}>
            <RBox x={0} y={c.h*0.35} w={c.w} h={c.h*0.5} c={RP.cream}/>
            <RBox x={c.w*0.15} y={c.h*0.1} w={c.w*0.7} h={c.h*0.55} c={RP.white}/>
            <RBox x={c.w*0.35} y={0} w={c.w*0.4} h={c.h*0.45} c={RP.white}/>
            <RBox x={0} y={c.h*0.7} w={c.w} h={c.h*0.18} c={RP.skyC}/>
          </div>
        );
      })}
    </>
  );
}

// distant mesas (desert)
function RMesas({camX, worldW}){
  const RP = useRP();
  const mesas = [];
  for (let i=0; i<22; i++){
    mesas.push({x: i*260, y: 220 + (i%3)*10, w: 240, h: 120, c: i%2?RP.nav3:RP.nav2});
  }
  return (
    <div style={{position:'absolute', left:0, top:0}}>
      {mesas.map((m,i)=>(
        <div key={i} style={{
          position:'absolute',
          left: m.x - camX*0.55,
          top: m.y, width: m.w, height: m.h,
          background: m.c,
          clipPath:'polygon(0% 100%, 0% 35%, 18% 18%, 60% 25%, 78% 8%, 100% 30%, 100% 100%)',
        }}/>
      ))}
    </div>
  );
}

// ── Ground / circuit ────────────────────────────────────────────────────
function RGround({worldW, gy, t}){
  const RP = useRP();
  // Road spans gy..gy+58. Extra 500px filler ensures no gap at bottom.
  return (
    <>
      {/* desert sand top strip */}
      <RBox x={0} y={gy} w={worldW} h={4} c={RP.sand1}/>
      <RBox x={0} y={gy+4} w={worldW} h={8} c={RP.sand2}/>
      {/* asphalt road — extends the full world width */}
      <RBox x={0} y={gy+12} w={worldW} h={48} c={RP.track}/>
      <RBox x={0} y={gy+12} w={worldW} h={2} c={RP.trackL}/>
      <RBox x={0} y={gy+58} w={worldW} h={2} c={RP.trackL}/>
      {/* dashed center line — animated scroll */}
      {Array.from({length: Math.ceil(worldW/40)+2}).map((_, i)=>{
        const dx = (t*120)%40;
        return <RBox key={i} x={i*40 - 40 + dx} y={gy+33} w={20} h={3} c={RP.trackEdge}/>;
      })}
      {/* ground filler below road */}
      <RBox x={0} y={gy+60} w={worldW} h={500} c={RP.sand3}/>
    </>
  );
}

// ── SCENE 1: Mech Chicken in Cage ───────────────────────────────────────
function MechChicken({baseX, gy}){
  const RP = useRP();
  const t = useTime();
  const eye = Math.sin(t*2.2)>0.95 ? RP.goldD : RP.gold;
  const armBob = Math.sin(t*1.4)*2;
  const beakOpen = Math.sin(t*1.1)>0.7 ? 6 : 4;

  return (
    <div style={{position:'absolute', left:baseX, top:0, width:780, height:gy+10}}>
      {/* cage scaffolding */}
      <RBox x={0} y={gy-360} w={6} h={360} c={RP.metalL}/>
      <RBox x={770} y={gy-360} w={6} h={360} c={RP.metalL}/>
      <RBox x={0} y={gy-360} w={780} h={6} c={RP.metal}/>
      <RBox x={0} y={gy-180} w={780} h={4} c={RP.metalL}/>
      {/* warning stripes */}
      {Array.from({length:20}).map((_,i)=>(
        <RBox key={i} x={i*40} y={gy-360} w={20} h={6} c={i%2?RP.gold:RP.ink}/>
      ))}
      {/* vertical bars */}
      {[80, 200, 320, 460, 580, 700].map((bx,i)=>(
        <RBox key={i} x={bx} y={gy-354} w={4} h={354} c={RP.metalD} style={{opacity:0.55}}/>
      ))}

      {/* steam pipes */}
      <RBox x={20} y={gy-340} w={12} h={340} c={RP.metalD}/>
      <RBox x={20} y={gy-280} w={40} h={10} c={RP.metalD}/>
      <RBox x={750} y={gy-340} w={12} h={340} c={RP.metalD}/>
      <RBox x={720} y={gy-280} w={40} h={10} c={RP.metalD}/>

      {/* steam puffs */}
      {[0,1,2,3].map(i=>{
        const ph = (t*0.7+i*0.3)%1;
        return <RBox key={'sl'+i} x={56 + Math.sin((t+i)*2)*8} y={gy-300 - ph*120} w={14+i*2} h={14+i*2}
          c={RP.steam} style={{opacity:Math.max(0, 0.85 - ph)}} />;
      })}
      {[0,1,2,3].map(i=>{
        const ph = (t*0.7+i*0.3+0.5)%1;
        return <RBox key={'sr'+i} x={696 + Math.sin((t+i)*2)*8} y={gy-300 - ph*120} w={14+i*2} h={14+i*2}
          c={RP.steam} style={{opacity:Math.max(0, 0.85 - ph)}} />;
      })}

      {/* MECH CHICKEN — stylized rooster mech */}
      <div style={{position:'absolute', left:200, top:gy-320}}>
        {/* legs (mech) */}
        <RBox x={120} y={250} w={16} h={70} c={RP.metalD}/>
        <RBox x={180} y={250} w={16} h={70} c={RP.metalD}/>
        <RBox x={110} y={310} w={36} h={10} c={RP.metalL}/>
        <RBox x={170} y={310} w={36} h={10} c={RP.metalL}/>
        <RBox x={124} y={280} w={8} h={6} c={RP.gold}/>
        <RBox x={184} y={280} w={8} h={6} c={RP.gold}/>

        {/* body (egg-shape via stacked rects) */}
        <RBox x={70} y={140} w={200} h={24} c={RP.cream}/>
        <RBox x={56} y={164} w={228} h={50} c={RP.cream}/>
        <RBox x={50} y={214} w={240} h={36} c={RP.cream}/>
        <RBox x={70} y={250} w={200} h={10} c={RP.cream}/>
        {/* metal underplate */}
        <RBox x={70} y={232} w={200} h={20} c={RP.metalL}/>
        <RBox x={70} y={232} w={200} h={4} c={RP.metalD}/>
        {/* gold circuit lines */}
        <RBox x={80} y={210} w={180} h={2} c={RP.gold}/>
        <RBox x={120} y={186} w={4} h={28} c={RP.gold}/>
        <RBox x={180} y={186} w={4} h={28} c={RP.gold}/>
        <RBox x={150} y={186} w={2} h={28} c={RP.goldD}/>
        <RBox x={100} y={196} w={20} h={2} c={RP.goldL} style={{opacity:0.6+0.4*Math.sin(t*4)}}/>
        <RBox x={210} y={196} w={20} h={2} c={RP.goldL} style={{opacity:0.6+0.4*Math.sin(t*4+1)}}/>

        {/* wing (left) — flap */}
        <div style={{position:'absolute', left:30, top:170 + armBob, transformOrigin:'top right', transform:`rotate(${armBob*2}deg)`}}>
          <RBox x={0} y={0} w={50} h={14} c={RP.cream}/>
          <RBox x={0} y={14} w={56} h={14} c={RP.cream}/>
          <RBox x={0} y={28} w={48} h={14} c={RP.cream}/>
          <RBox x={2} y={2} w={30} h={2} c={RP.metalL}/>
        </div>
        {/* wing (right) */}
        <div style={{position:'absolute', left:240, top:170 - armBob, transformOrigin:'top left', transform:`rotate(${-armBob*2}deg)`}}>
          <RBox x={0} y={0} w={50} h={14} c={RP.cream}/>
          <RBox x={-6} y={14} w={56} h={14} c={RP.cream}/>
          <RBox x={2} y={28} w={48} h={14} c={RP.cream}/>
          <RBox x={28} y={2} w={20} h={2} c={RP.metalL}/>
        </div>

        {/* head */}
        <RBox x={120} y={70} w={100} h={70} c={RP.cream}/>
        <RBox x={130} y={62} w={80} h={8} c={RP.cream}/>
        {/* comb (red) */}
        <RBox x={140} y={50} w={14} h={14} c={RP.red}/>
        <RBox x={158} y={42} w={14} h={22} c={RP.red}/>
        <RBox x={176} y={50} w={14} h={14} c={RP.red}/>
        {/* eyes (visor) */}
        <RBox x={130} y={88} w={80} h={14} c={RP.ink}/>
        <RBox x={140} y={92} w={20} h={6} c={eye}/>
        <RBox x={180} y={92} w={20} h={6} c={eye}/>
        {/* beak */}
        <RBox x={216} y={108} w={14} h={6} c={RP.gold}/>
        <RBox x={216} y={114} w={beakOpen} h={4} c={RP.goldD}/>
        {/* wattle */}
        <RBox x={150} y={130} w={10} h={10} c={RP.red}/>

        {/* tail feathers */}
        <RBox x={20} y={150} w={36} h={14} c={RP.cream}/>
        <RBox x={10} y={130} w={36} h={14} c={RP.cream}/>
        <RBox x={4}  y={108} w={36} h={14} c={RP.cream}/>
      </div>
    </div>
  );
}

// ── SCENE 2: Torii Gate w/ "RIAL CHICK" neon ────────────────────────────
function ToriiNeon({baseX, gy}){
  const RP = useRP();
  const t = useTime();
  const flicker = 0.7 + 0.3*Math.abs(Math.sin(t*5));
  const swirl = (t*100)%360;
  return (
    <div style={{position:'absolute', left:baseX, top:0, width:560, height:gy+10}}>
      {/* base stones */}
      <RBox x={120} y={gy-6} w={50} h={6} c={RP.metalL}/>
      <RBox x={390} y={gy-6} w={50} h={6} c={RP.metalL}/>

      {/* pillars */}
      <RBox x={130} y={gy-260} w={30} h={260} c={RP.nav1}/>
      <RBox x={130} y={gy-260} w={6} h={260} c={RP.gold}/>
      <RBox x={400} y={gy-260} w={30} h={260} c={RP.nav1}/>
      <RBox x={400} y={gy-260} w={6} h={260} c={RP.gold}/>

      {/* top beam */}
      <RBox x={100} y={gy-280} w={360} h={20} c={RP.nav1}/>
      <RBox x={100} y={gy-280} w={360} h={4} c={RP.gold}/>
      <RBox x={94}  y={gy-294} w={372} h={14} c={RP.nav0}/>
      <RBox x={94}  y={gy-294} w={372} h={4} c={RP.goldD}/>

      {/* second beam */}
      <RBox x={140} y={gy-240} w={280} h={12} c={RP.nav2}/>

      {/* portal swirl */}
      <div style={{position:'absolute', left:170, top:gy-220, width:220, height:200, overflow:'hidden'}}>
        <div style={{
          position:'absolute', inset:0,
          background:`conic-gradient(from ${swirl}deg, ${RP.gold}, ${RP.cyan}, ${RP.goldL}, ${RP.gold})`,
          opacity: 0.85*flicker,
          clipPath:'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
        }}/>
        <div style={{
          position:'absolute', left:30, top:30, width:160, height:140,
          background:`conic-gradient(from ${-swirl*1.4}deg, #fff, ${RP.gold}, #fff)`,
          opacity: 0.8*flicker,
          clipPath:'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
        }}/>
        {/* sparkle pixels */}
        {Array.from({length:18}).map((_,i)=>{
          const a = (t*0.7 + i*0.4)%1;
          return <RBox key={i}
            x={20 + (i*13)%180}
            y={20 + (i*23)%160 - a*60}
            w={3} h={3} c={a<0.5?RP.goldL:RP.cyanL}
            style={{opacity: 1-a}}/>;
        })}
      </div>

      {/* hanging neon sign "RIAL CHICK" */}
      <div style={{position:'absolute', left:120, top:gy-360}}>
        {/* hanging rope */}
        <RBox x={140} y={0} w={2} h={20} c={RP.metalD}/>
        <RBox x={180} y={0} w={2} h={20} c={RP.metalD}/>
        {/* sign plate */}
        <RBox x={50} y={20} w={220} h={70} c={RP.nav0}/>
        <RBox x={50} y={20} w={220} h={4} c={RP.gold}/>
        <RBox x={50} y={86} w={220} h={4} c={RP.gold}/>
        <RBox x={50} y={20} w={4} h={70} c={RP.gold}/>
        <RBox x={266} y={20} w={4} h={70} c={RP.gold}/>
        {/* neon tube text */}
        <div style={{
          position:'absolute', left:0, top:30, width:320, textAlign:'center',
          fontFamily:'"Press Start 2P", monospace',
          fontSize:24, color: RP.gold, opacity: flicker,
          textShadow: `0 0 6px ${RP.gold}, 0 0 14px ${RP.gold}, 2px 2px 0 ${RP.nav0}`,
          letterSpacing:'.06em',
        }}>RIAL CHICK</div>
        <div style={{
          position:'absolute', left:0, top:62, width:320, textAlign:'center',
          fontFamily:'"Press Start 2P", monospace',
          fontSize:8, color: RP.cyan, opacity: 0.5+0.5*flicker,
          textShadow:`0 0 4px ${RP.cyan}`,
          letterSpacing:'.18em',
        }}>★ ARCADE ★</div>
      </div>
    </div>
  );
}

// ── SCENE 3: Busy street with running chicks + coins ────────────────────
function StreetChicks({baseX, gy}){
  const RP = useRP();
  const { density } = useTweakValues();
  const t = useTime();
  // density multiplier: sparse=0.4, busy=1, chaos=2
  const dm = density==='sparse'?0.4 : density==='chaos'?2 : 1;
  const baseChicks = [
    {phase:0.0, speed:80,  yOff:0,  pal:'a'},
    {phase:0.2, speed:120, yOff:-2, pal:'b'},
    {phase:0.5, speed:90,  yOff:1,  pal:'a'},
    {phase:0.8, speed:140, yOff:-1, pal:'b'},
    {phase:1.1, speed:70,  yOff:2,  pal:'a'},
    {phase:1.6, speed:100, yOff:0,  pal:'b'},
    {phase:1.9, speed:130, yOff:-2, pal:'a'},
    {phase:2.3, speed:85,  yOff:1,  pal:'b'},
    {phase:2.7, speed:150, yOff:0,  pal:'a'},
    {phase:3.1, speed:95,  yOff:-1, pal:'b'},
    {phase:3.5, speed:110, yOff:2,  pal:'a'},
    {phase:3.9, speed:75,  yOff:0,  pal:'b'},
  ];
  const chicks = baseChicks.slice(0, Math.max(2, Math.round(6*dm)));
  const coinCount = Math.max(4, Math.round(14*dm));
  const coins = Array.from({length:coinCount}).map((_,i)=>({i, x:40+i*(700/coinCount), phase:(i*0.31)%1, sp:0.6+i*0.05}));

  return (
    <div style={{position:'absolute', left:baseX, top:0, width:760, height:gy+10}}>
      {/* sidewalk shopfronts (back) */}
      {[
        {x:0,   w:160, h:160, c:RP.nav1, t:'GAME'},
        {x:170, w:140, h:200, c:RP.nav2, t:'EGG'},
        {x:320, w:170, h:170, c:RP.nav1, t:'BIT'},
        {x:500, w:140, h:190, c:RP.nav2, t:'BAR'},
        {x:650, w:110, h:160, c:RP.nav3, t:'POT'},
      ].map((s,i)=>(
        <div key={i} style={{position:'absolute', left:s.x, top:gy-s.h-30}}>
          <RBox x={0} y={0} w={s.w} h={s.h} c={s.c}/>
          <RBox x={0} y={0} w={s.w} h={4} c={RP.gold}/>
          {/* windows */}
          <RBox x={10} y={20} w={s.w-20} h={36} c={RP.cyan} style={{opacity:0.55}}/>
          <RBox x={10} y={20} w={s.w-20} h={4} c={RP.cyanD}/>
          {/* sign */}
          <div style={{
            position:'absolute', left:0, top:s.h-44, width:s.w, textAlign:'center',
            fontFamily:'"Press Start 2P", monospace', fontSize:10,
            color:RP.gold, letterSpacing:'.1em',
            textShadow:`0 0 4px ${RP.gold}, 1px 1px 0 ${RP.ink}`,
            opacity: 0.7+0.3*Math.sin(t*3+i),
          }}>{s.t}</div>
          {/* awning */}
          <RBox x={-4} y={s.h-22} w={s.w+8} h={6} c={RP.gold}/>
          <RBox x={-4} y={s.h-16} w={s.w+8} h={4} c={RP.goldD}/>
        </div>
      ))}

      {/* lampposts */}
      {[80, 380, 680].map((lx,i)=>(
        <div key={i} style={{position:'absolute', left:lx, top:gy-180}}>
          <RBox x={0} y={0} w={4} h={180} c={RP.metalD}/>
          <RBox x={-8} y={0} w={20} h={6} c={RP.metalD}/>
          <RBox x={-6} y={6} w={16} h={10} c={RP.gold} style={{opacity:0.6+0.4*Math.sin(t*5+i)}}/>
        </div>
      ))}

      {/* Running chicks crossing the road — smooth left-to-right loop */}
      {chicks.map((c, i)=>{
        // wrap range 0..820 (scene width 760 + 60 offscreen buffer)
        const span = 820;
        const total = (t*c.speed + c.phase*span) % span;
        const x = total - 30;
        // fade in from left edge, fade out at right edge → hides the teleport
        const fadeW = 40;
        const op = Math.min(total/fadeW, 1, (span-total)/fadeW);
        const frame = Math.floor(t*10 + i*0.5)%2;
        return <RunningChick key={i} x={x} y={gy+18 + c.yOff} frame={frame} pal={c.pal} op={op}/>;
      })}

      {/* floating coins */}
      {coins.map(c=>{
        const ph = (t*c.sp + c.phase)%1;
        const y = gy-30 - ph*200;
        const op = 1 - ph;
        const flip = Math.floor(t*8+c.i)%4;
        return <Coin key={c.i} x={c.x} y={y} flip={flip} op={op}/>;
      })}
    </div>
  );
}

function RunningChick({x,y,frame,pal,op=1}){
  const RP = useRP();
  const body = pal==='a' ? RP.cream : RP.white;
  const beak = RP.gold;
  const legY = frame===0 ? 0 : 3;
  const legY2 = frame===0 ? 3 : 0;
  return (
    <div style={{position:'absolute', left:x, top:y, opacity:op}}>
      {/* body */}
      <RBox x={0} y={4} w={18} h={14} c={body}/>
      <RBox x={2} y={2} w={14} h={4} c={body}/>
      {/* head */}
      <RBox x={12} y={-4} w={10} h={10} c={body}/>
      <RBox x={14} y={-2} w={2} h={2} c={RP.ink}/>
      {/* comb */}
      <RBox x={14} y={-7} w={6} h={3} c={RP.red}/>
      {/* beak */}
      <RBox x={22} y={0} w={4} h={3} c={beak}/>
      {/* tail */}
      <RBox x={-4} y={2} w={6} h={6} c={body}/>
      {/* legs */}
      <RBox x={4} y={18+legY} w={2} h={6-legY} c={beak}/>
      <RBox x={12} y={18+legY2} w={2} h={6-legY2} c={beak}/>
    </div>
  );
}

function Coin({x,y,flip,op}){
  const RP = useRP();
  const w = flip===0?10 : flip===1?6 : flip===2?2 : 6;
  const fill = flip===2 ? RP.goldD : RP.gold;
  const hi = flip===0 ? RP.goldL : null;
  return (
    <div style={{position:'absolute', left:x, top:y, opacity:op}}>
      <RBox x={(10-w)/2} y={0} w={w} h={10} c={fill}/>
      {hi && <RBox x={3} y={2} w={2} h={4} c={hi}/>}
      <div style={{position:'absolute', left:0, top:11, width:10, height:2, background:'rgba(0,0,0,0.25)', borderRadius:'50%', filter:'blur(1px)'}}/>
    </div>
  );
}

// ── SCENE 4: Racing Circuit + leaderboard ───────────────────────────────
function RaceCircuit({baseX, gy}){
  const RP = useRP();
  const { density } = useTweakValues();
  const dm = density==='sparse'?0.5 : density==='chaos'?1.8 : 1;
  const t = useTime();
  // animated leaderboard scores
  const scores = [
    {n:'CHK01', s: (12450 + Math.floor(t*20))%99999},
    {n:'PXL.R', s: (10210 + Math.floor(t*14))%99999},
    {n:'GLD.7', s: (9888  + Math.floor(t*11))%99999},
    {n:'NEO.X', s: (8742  + Math.floor(t*8))%99999},
    {n:'KAI.4', s: (7602  + Math.floor(t*6))%99999},
  ];
  const scoreCols = [RP.gold, RP.cyan, RP.goldL, RP.cream, RP.cream];

  return (
    <div style={{position:'absolute', left:baseX, top:0, width:760, height:gy+10}}>
      {/* main building */}
      <RBox x={40} y={gy-280} w={680} h={280} c={RP.nav1}/>
      <RBox x={40} y={gy-280} w={680} h={6} c={RP.gold}/>
      <RBox x={40} y={gy-284} w={680} h={4} c={RP.goldD}/>
      <RBox x={40} y={gy-50} w={680} h={50} c={RP.nav0}/>

      {/* checkered top trim */}
      {Array.from({length:34}).map((_,i)=>(
        <RBox key={i} x={40+i*20} y={gy-300} w={20} h={16} c={i%2?RP.cream:RP.ink}/>
      ))}

      {/* "ARENA" sign */}
      <div style={{
        position:'absolute', left:40, top:gy-330, width:680, textAlign:'center',
        fontFamily:'"Press Start 2P", monospace', fontSize:14, color:RP.gold,
        textShadow:`0 0 6px ${RP.gold}, 2px 2px 0 ${RP.ink}`,
        letterSpacing:'.12em',
      }}>★ CIRCUIT ARENA ★</div>

      {/* big leaderboard scoreboard */}
      <div style={{position:'absolute', left:90, top:gy-260, width:400, height:200,
        background: RP.ink, border:`6px solid ${RP.gold}`,
        boxShadow:`inset 0 0 0 2px ${RP.goldD}`}}>
        <div style={{
          textAlign:'center', padding:'10px 0',
          fontFamily:'"Press Start 2P", monospace', fontSize:12,
          color:RP.cyan,
          textShadow:`0 0 4px ${RP.cyan}`,
          letterSpacing:'.1em',
          borderBottom:`2px solid ${RP.metalD}`,
        }}>LEADERBOARD</div>
        {scores.map((s,i)=>(
          <div key={i} style={{
            display:'flex', justifyContent:'space-between',
            padding:'6px 16px',
            fontFamily:'"Press Start 2P", monospace', fontSize:10,
            color: scoreCols[i],
          }}>
            <span style={{opacity:0.7}}>{String(i+1).padStart(2,'0')}</span>
            <span>{s.n}</span>
            <span style={{
              minWidth:80, textAlign:'right',
              textShadow: i<2 ? `0 0 4px ${scoreCols[i]}` : 'none',
            }}>{String(s.s).padStart(5,'0')}</span>
          </div>
        ))}
      </div>

      {/* ticker bar bottom of building */}
      <div style={{
        position:'absolute', left:40, top:gy-46, width:680, height:34,
        overflow:'hidden', background:RP.nav0,
        borderTop:`2px solid ${RP.gold}`,
      }}>
        <div style={{
          position:'absolute',
          left: -((t*120)%1200),
          whiteSpace:'nowrap', padding:'8px 0',
          fontFamily:'"Press Start 2P", monospace', fontSize:10,
          color:RP.gold, letterSpacing:'.1em',
        }}>
          ★ LIVE RACE 04 · CHK01 +4280 · PXL.R DRAFTING · GLD.7 PIT IN 2 LAPS · ★ JACKPOT 124K · NEO.X CRASHED OUT · ★ LIVE RACE 04 · CHK01 +4280 ·
        </div>
      </div>

      {/* small crowd silhouettes lining the front */}
      {Array.from({length:Math.max(6, Math.round(18*dm))}).map((_,i)=>{
        const bob = Math.sin(t*4+i)*2;
        return (
          <div key={i} style={{position:'absolute', left:520 + (i%6)*22, top:gy-32 - Math.floor(i/6)*8 + bob}}>
            <RBox x={4} y={0} w={6} h={6} c={RP.ink}/>
            <RBox x={2} y={6} w={10} h={12} c={RP.ink}/>
            {(i%4===0) && <RBox x={1} y={-4} w={3} h={6} c={RP.ink}/>}
            {(i%4===0) && <RBox x={10} y={-4} w={3} h={6} c={RP.ink}/>}
          </div>
        );
      })}

      {/* racing chick zooming on circuit out front */}
      <RacingChick x={(t*200)%760} gy={gy} t={t}/>
    </div>
  );
}

function RacingChick({x, gy, t}){
  const RP = useRP();
  // chick on a tiny kart, with motion lines
  return (
    <div style={{position:'absolute', left:x, top:gy+18}}>
      {/* motion lines */}
      <RBox x={-30} y={6} w={20} h={2} c={RP.cyanL} style={{opacity:0.7}}/>
      <RBox x={-46} y={12} w={26} h={2} c={RP.gold} style={{opacity:0.7}}/>
      <RBox x={-22} y={18} w={14} h={2} c={RP.cyanL} style={{opacity:0.5}}/>
      {/* kart */}
      <RBox x={0} y={10} w={36} h={10} c={RP.gold}/>
      <RBox x={0} y={10} w={36} h={2} c={RP.goldL}/>
      <RBox x={4} y={20} w={8} h={6} c={RP.ink}/>
      <RBox x={24} y={20} w={8} h={6} c={RP.ink}/>
      {/* chick driver */}
      <RBox x={10} y={-4} w={14} h={14} c={RP.cream}/>
      <RBox x={14} y={-2} w={2} h={2} c={RP.ink}/>
      <RBox x={22} y={2} w={4} h={3} c={RP.gold}/>{/* beak */}
      <RBox x={14} y={-7} w={6} h={3} c={RP.red}/>
      {/* helmet stripe */}
      <RBox x={10} y={-4} w={14} h={2} c={RP.cyan}/>
    </div>
  );
}

// ── SCENE 5: Concert / Rialo R Stage ────────────────────────────────────
function RStage({baseX, gy}){
  const RP = useRP();
  const { density } = useTweakValues();
  const dm = density==='sparse'?0.5 : density==='chaos'?1.8 : 1;
  const t = useTime();
  const flicker = 0.7 + 0.3*Math.abs(Math.sin(t*4));

  return (
    <div style={{position:'absolute', left:baseX, top:0, width:680, height:gy+10}}>
      {/* stage platform */}
      <RBox x={40} y={gy-30} w={600} h={30} c={RP.nav0}/>
      <RBox x={40} y={gy-30} w={600} h={4} c={RP.gold}/>

      {/* speaker stacks */}
      <RBox x={50} y={gy-180} w={70} h={150} c={RP.ink}/>
      <RBox x={56} y={gy-174} w={58} h={56} c={RP.metalD}/>
      <RBox x={70} y={gy-160} w={30} h={30} c={RP.metal}/>
      <RBox x={56} y={gy-110} w={58} h={56} c={RP.metalD}/>
      <RBox x={70} y={gy-96} w={30} h={30} c={RP.metal}/>

      <RBox x={560} y={gy-180} w={70} h={150} c={RP.ink}/>
      <RBox x={566} y={gy-174} w={58} h={56} c={RP.metalD}/>
      <RBox x={580} y={gy-160} w={30} h={30} c={RP.metal}/>
      <RBox x={566} y={gy-110} w={58} h={56} c={RP.metalD}/>
      <RBox x={580} y={gy-96} w={30} h={30} c={RP.metal}/>

      {/* backdrop (navy) */}
      <RBox x={130} y={gy-340} w={420} h={310} c={RP.nav0}/>
      <RBox x={130} y={gy-340} w={420} h={4} c={RP.gold}/>
      <RBox x={130} y={gy-34}  w={420} h={4} c={RP.gold}/>

      {/* truss */}
      <RBox x={120} y={gy-360} w={440} h={20} c={RP.metalD}/>
      {Array.from({length:22}).map((_,i)=>(
        <RBox key={i} x={120+i*20} y={gy-356} w={4} h={12} c={RP.metalL}/>
      ))}

      {/* spotlights atop truss */}
      {[0,1,2,3,4,5].map(i=>(
        <div key={i} style={{position:'absolute', left:140+i*70, top:gy-340}}>
          <RBox x={0} y={0} w={20} h={10} c={RP.metalD}/>
          <RBox x={4} y={10} w={12} h={6} c={RP.gold} style={{opacity: 0.6+0.4*Math.sin(t*4+i)}}/>
        </div>
      ))}

      {/* spotlight beams (subtle gradient bars) */}
      {[0,2,4].map(i=>(
        <div key={i} style={{
          position:'absolute',
          left: 140 + i*70 + 6,
          top: gy-326,
          width: 8, height: 290,
          background:`linear-gradient(180deg, ${RP.gold} 0%, rgba(245,197,24,0) 100%)`,
          opacity: 0.35*flicker,
          transform:'skewX(-6deg)',
          transformOrigin:'top',
        }}/>
      ))}

      {/* GIANT RIALO LOGO — centered on billboard.
          Billboard: x 130..550 (w=420, cx=340), y gy-340..gy-34 (h=306, cy=gy-187).
          Logo: 190x190 (~62% of billboard height), caption 16px below. */}
      <div style={{position:'absolute', left:340-95, top:gy-187-95, width:190, height:190}}>
        {/* gold glow halo behind */}
        <div style={{
          position:'absolute', inset:-30,
          background:`radial-gradient(circle at 50% 50%, ${RP.gold}cc 0%, ${RP.gold}55 30%, transparent 70%)`,
          opacity: flicker,
          filter:'blur(8px)',
        }}/>
        {/* image filled gold via mask */}
        <div style={{
          position:'absolute', inset:0,
          background: RP.gold,
          opacity: flicker,
          WebkitMaskImage: `url(${window.__resources?.rialoLogo || 'rialo-logo.png'})`,
          maskImage: `url(${window.__resources?.rialoLogo || 'rialo-logo.png'})`,
          WebkitMaskRepeat: 'no-repeat',
          maskRepeat: 'no-repeat',
          WebkitMaskSize: 'contain',
          maskSize: 'contain',
          WebkitMaskPosition: 'center',
          maskPosition: 'center',
          filter: `drop-shadow(0 0 10px ${RP.gold}) drop-shadow(0 0 22px ${RP.gold})`,
        }}/>
      </div>

      {/* "RIALO" caption — centered horizontally, 16px below logo bottom (gy-187+95+16=gy-76) */}
      <div style={{
        position:'absolute', left:130, top:gy-187+95+16, width:420, textAlign:'center',
        fontFamily:'"Press Start 2P", monospace', fontSize:16,
        color: RP.gold, letterSpacing:'.5em',
        textShadow:`0 0 8px ${RP.gold}, 0 0 20px ${RP.gold}, 2px 2px 0 ${RP.ink}`,
        opacity: flicker,
      }}>R I A L O</div>

      {/* crowd in front of stage */}
      {Array.from({length:Math.max(6, Math.round(18*dm))}).map((_,i)=>{
        const bob = Math.sin(t*4 + i*0.7)*3;
        const handsUp = (i%3===0);
        return (
          <div key={i} style={{position:'absolute', left:50 + i*32, top:gy-30 + bob, zIndex:5}}>
            <RBox x={4} y={0} w={8} h={8} c={RP.ink}/>
            <RBox x={2} y={8} w={12} h={16} c={RP.ink}/>
            {handsUp && <>
              <RBox x={-2} y={-2} w={3} h={10} c={RP.ink} style={{transform:`rotate(${-10+bob*2}deg)`, transformOrigin:'bottom'}}/>
              <RBox x={14} y={-2} w={3} h={10} c={RP.ink} style={{transform:`rotate(${10-bob*2}deg)`, transformOrigin:'bottom'}}/>
            </>}
            <RBox x={3} y={24} w={4} h={6} c={RP.ink}/>
            <RBox x={9} y={24} w={4} h={6} c={RP.ink}/>
          </div>
        );
      })}
    </div>
  );
}

// ── World composer ──────────────────────────────────────────────────────
function RialChickWorld({stageW, stageH}){
  const RP = useRP();
  const { camera } = useTweakValues();
  const t = useTime();
  const gy = stageH - 80; // ground line — road strip sits at gy+22..gy+58, fully within stageH
  const worldW = 4400;

  // Camera path — cinematic pan, locked wide, or lazy drift
  let camX, zoom;
  if (camera === 'locked'){
    // single fixed wide framing centered on the world midpoint
    camX = (worldW - stageW)/2;
    zoom = 1;
  } else if (camera === 'drift'){
    // gentle oscillating drift that lazily breathes across the world
    const center = (worldW - stageW)/2;
    camX = center + Math.sin(t*0.35)*1400;
    zoom = 1 + Math.sin(t*0.5)*0.04;
  } else {
    // cinematic: slow continuous pan with brief holds at each scene
    camX = interpolate(
      [0,    2,   5,   9,  13,  17,  21,  24,  27,  30],
      [0,    0, 700,1500,2200,2700,2880,2880,2880,2880],
      Easing.easeInOutCubic
    )(t);
    zoom = interpolate(
      [0, 3, 5, 9, 13, 17, 22, 27, 30],
      [1, 1, 1.04, 1, 1.05, 1, 1.05, 1.06, 1],
      Easing.easeInOutCubic
    )(t);
  }

  return (
    <div style={{
      position:'absolute', inset:0, overflow:'hidden',
      background:`linear-gradient(180deg, ${RP.skyA} 0%, ${RP.skyB} 60%, ${RP.skyC} 100%)`,
    }}>
      <RSky worldW={worldW} camX={camX} t={t}/>
      <RMesas camX={camX} worldW={worldW}/>

      <div style={{
        position:'absolute', left:0, top:0, width:worldW, height:stageH,
        transform:`translateX(${-camX}px) scale(${zoom})`,
        transformOrigin:'50% 65%',
        imageRendering:'pixelated',
      }}>
        <RGround worldW={worldW} gy={gy} t={t}/>
        <MechChicken   baseX={120}  gy={gy}/>
        <ToriiNeon     baseX={1000} gy={gy}/>
        <StreetChicks  baseX={1700} gy={gy}/>
        <RaceCircuit   baseX={2600} gy={gy}/>
        <RStage        baseX={3500} gy={gy}/>
      </div>

      {/* CRT scanlines + vignette — vignette intensity follows mood */}
      <div style={{
        position:'absolute', inset:0, pointerEvents:'none',
        background:`
          repeating-linear-gradient(180deg, rgba(0,0,0,${0.04+RP.vignette*0.06}) 0 1px, transparent 1px 3px),
          radial-gradient(140% 110% at 50% 50%, transparent ${70-RP.vignette*30}%, rgba(0,0,0,${RP.vignette}) 100%)
        `,
        mixBlendMode:'overlay',
      }}/>

      {/* Mood-driven neon overlay glow */}
      {RP.glow > 1 && (
        <div style={{
          position:'absolute', inset:0, pointerEvents:'none',
          background:`radial-gradient(80% 60% at 50% 70%, ${RP.cyan}22, transparent 70%)`,
          mixBlendMode:'screen',
        }}/>
      )}

      {/* corner brand mark */}
      <div style={{
        position:'absolute', left:24, top:18,
        fontFamily:'"Press Start 2P", monospace',
        color: RP.gold, fontSize:12, letterSpacing:'.12em',
        textShadow:`2px 2px 0 ${RP.ink}, 0 0 8px ${RP.gold}`,
      }}>
        RIAL CHICK
      </div>

      {/* corner timecode */}
      <div style={{
        position:'absolute', right:24, top:18,
        fontFamily:'"Press Start 2P", monospace',
        color: RP.cream, fontSize:8, letterSpacing:'.12em',
        textShadow:`2px 2px 0 ${RP.ink}`,
        opacity:0.7,
      }}>
        T+{t.toFixed(1)}s · 16:3
      </div>
    </div>
  );
}

Object.assign(window, { RialChickWorld, TweakContext });
