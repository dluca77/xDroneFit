"use client";
import { FormEvent, useEffect, useMemo, useState } from "react";
import DroneFitApp from "./DroneFitApp";
export type ProjectRecord={id:string;code:string;name:string;stateJson:string;createdAt:string;updatedAt:string};
function BrandMark({small=false}:{small?:boolean}){return <span className={small?"xf-mark xf-small":"xf-mark"} aria-hidden="true"><i/><i/><i/><i/><b>x</b></span>}
export default function ProjectPortal(){
 const [projects,setProjects]=useState<ProjectRecord[]>([]),[current,setCurrent]=useState<ProjectRecord|null>(null),[loading,setLoading]=useState(true),[code,setCode]=useState("SX26259"),[name,setName]=useState("Tuiterd Holten"),[query,setQuery]=useState(""),[error,setError]=useState("");
 async function refresh(){setLoading(true);try{const r=await fetch("/api/projects");if(r.ok)setProjects(await r.json())}finally{setLoading(false)}}
 useEffect(()=>{
  if("scrollRestoration" in window.history) window.history.scrollRestoration="manual";
  const previousScrollBehavior=document.documentElement.style.scrollBehavior;
  document.documentElement.style.scrollBehavior="auto";
  const resetScroll=()=>{
   if(!current && window.location.hash) window.history.replaceState(null,"",window.location.pathname+window.location.search);
   window.scrollTo(0,0);
  };
  resetScroll();
  const frame=window.requestAnimationFrame(resetScroll);
  const timer=window.setTimeout(resetScroll,80);
  window.addEventListener("pageshow",resetScroll);
  return()=>{document.documentElement.style.scrollBehavior=previousScrollBehavior;window.cancelAnimationFrame(frame);window.clearTimeout(timer);window.removeEventListener("pageshow",resetScroll)};
 },[current]);
 useEffect(()=>{refresh()},[]);
 async function create(e:FormEvent){e.preventDefault();setError("");const r=await fetch("/api/projects",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code,name,state:{projectName:name,site:{lat:52.282539407,lon:6.426162461},siteConfirmed:false}})});const data=await r.json();if(!r.ok){setError(data.error??"Project kon niet worden gemaakt.");return}setCurrent(data);setProjects(p=>[data,...p])}
 async function remove(p:ProjectRecord){if(!confirm(p.code+" - "+p.name+" verwijderen?"))return;await fetch("/api/projects/"+p.id,{method:"DELETE"});setProjects(v=>v.filter(x=>x.id!==p.id))}
 const filtered=useMemo(()=>projects.filter(p=>(p.code+" "+p.name).toLowerCase().includes(query.toLowerCase())),[projects,query]);
 if(current)return <DroneFitApp key={current.id} project={current} onBack={()=>{setCurrent(null);refresh()}}/>;
 return <main className="project-home xdf-home">
  <header className="xdf-nav">
   <a className="xdf-logo" href="#top" aria-label="xDroneFit home"><BrandMark/><span>xDrone<b>Fit</b></span></a>
   <nav aria-label="Hoofdnavigatie"><a href="#werkwijze">Werkwijze</a><a href="#projecten">Projecten</a></nav>
   <span className="xdf-private"><i/>Prive projectomgeving</span>
  </header>
  <section className="xdf-hero" id="top">
   <div className="xdf-copy"><span className="xdf-kicker"><i/>Camera matching voor vastgoed</span><h1>Van dronefoto naar <em>overtuigende render.</em></h1><p>Upload een dronefoto en teken twee haakse hulplijnen zoals in fSpy. xDroneFit berekent de exacte camerapositie en -hoek voor jouw Blender-model.</p><div className="xdf-actions"><a className="xdf-button" href="#projecten">Start een project <span>+</span></a><a className="xdf-textlink" href="#werkwijze">Bekijk hoe het werkt <span>↘</span></a></div><div className="xdf-proof"><strong>RD + NAP</strong><span>Exacte positie</span><strong>fSpy-lijnen</strong><span>Exacte kijkhoek</span><strong>BLENDER</strong><span>Renderklaar export</span></div></div>
   <div className="xdf-demo xdf-process-demo" aria-label="Overzicht van de xDroneFit-projectflow">
    <div className="process-head"><div className="demo-window-dots"><i/><i/><i/></div><span>xDRONEFIT / PROJECTFLOW</span><b>SX26259 · TUITERT HOLTEN</b><em><i/>OPGESLAGEN</em></div>
    <div className="process-shell">
     <aside className="process-nav" aria-label="Projectstappen"><small>PROJECTSETUP</small><ol><li><i>01</i><span>Locatie<small>Automatisch uit GPS</small></span><b className="process-check" aria-label="Voltooid"/></li><li><i>02</i><span>Dronefoto<small>DJI metadata</small></span><b className="process-check" aria-label="Voltooid"/></li><li><i>03</i><span>Camera<small>fSpy-hulplijnen</small></span><em/></li></ol></aside>
     <section className="process-workspace">
      <div className="process-title"><span><small>ACTIEF PROJECT</small><strong>Camera oplossen uit hulplijnen</strong></span><b>2 <small>/ 3</small></b></div>
      <div className="process-files">
       <article><i className="file-map">⌖</i><span><small>LOCATIE</small><strong>Tuitert, Holten</strong><em>RD 228491 · 479302</em></span><b>Gekoppeld</b></article>
       <article><i className="file-dji">DJI</i><span><small>DRONEFOTO</small><strong>DJI_0065_D.JPG</strong><em>8192 × 6144 · FC9313</em></span><b>Metadata gereed</b></article>
      </div>
      <div className="process-solve">
       <div className="solve-copy"><span><i/>VOLGENDE STAP</span><h3>Hulplijnen tekenen</h3><p>Teken twee stel haakse lijnen op de foto; xDroneFit berekent de kijkrichting en beeldhoek.</p><div className="solve-chips"><i>DJI EXIF</i><i>Vluchtpunten</i></div></div>
       <div className="solve-meter" aria-hidden="true"><div className="meter-ring"><span>03</span><i/><i/><i/></div><small>HULPLIJNEN TEKENEN</small></div>
      </div>
      <div className="process-output"><span><i/>CAMERA.DRONEFIT.JSON</span><div><i/><i/><i/><i/></div><button type="button" tabIndex={-1}>Naar cameramatch <b>→</b></button></div>
     </section>
    </div>
    <div className="process-foot" id="werkwijze"><span><i/>Locatie en foto gekoppeld</span><span>Camera nog niet bevestigd</span><b>PROJECT WORDT AUTOMATISCH OPGESLAGEN</b></div>
   </div>
  </section>
  <section className="xdf-flow"><span>01 <b>Zoek of bepaal de locatie</b></span><span>02 <b>Upload de dronefoto</b></span><span>03 <b>Teken de fSpy-hulplijnen</b></span><span>04 <b>Exporteer naar Blender</b></span></section>
  <section className="xdf-projects" id="projecten">
   <div className="xdf-section-head"><div><span>PROJECTOMGEVING</span><h2>Klaar om in te passen?</h2></div><p>Maak een nieuw SX-project of open een bestaand project. Alle camera- en locatiedata wordt automatisch opgeslagen.</p></div>
   <div className="project-grid xdf-project-grid">
    <form className="new-project-card xdf-new" onSubmit={create}><span className="card-kicker">+ NIEUW PROJECT</span><h2>Start een inpassing</h2><p>Gebruik dezelfde SX-code als in jullie projectmappen.</p><label>SX-projectnummer<input value={code} onChange={e=>setCode(e.target.value.toUpperCase())} placeholder="SX26259" pattern="SX[0-9]{4,}" required/></label><label>Locatie / projectnaam<input value={name} onChange={e=>setName(e.target.value)} placeholder="Tuiterd Holten" required/></label>{error&&<div className="form-error">{error}</div>}<button className="xdf-submit" type="submit">Project maken <span>↗</span></button></form>
    <div className="existing-projects xdf-existing"><div className="projects-head"><div><span className="card-kicker">BESTAANDE PROJECTEN</span><h2>Ga verder waar je was</h2></div><label className="xdf-search"><span>⌕</span><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Zoek SX of locatie..."/></label></div><div className="project-list">{loading?<div className="empty-projects"><i className="xdf-loader"/>Projecten laden...</div>:filtered.length===0?<div className="empty-projects"><b>Nog geen projecten</b><span>Maak hiernaast je eerste SX-project aan.</span></div>:filtered.map(p=>{let s:any={};try{s=JSON.parse(p.stateJson||"{}")}catch{}return <div className="project-item" key={p.id}><button className="project-open" onClick={()=>setCurrent(p)}><span className="project-code">{p.code}</span><span><b>{p.name}</b><small>{s.cameraSolution?"Camera berekend":s.drone?"Dronefoto geladen":"Locatie voorbereiden"}</small></span><time>{new Date(p.updatedAt).toLocaleDateString("nl-NL")}</time><i>↗</i></button><button className="delete-project" onClick={()=>remove(p)} aria-label="Verwijder project">×</button></div>})}</div></div>
   </div>
  </section>
  <footer className="xdf-footer"><a className="xdf-logo" href="#top"><BrandMark small/><span>xDrone<b>Fit</b></span></a><span>Vastgoed camera matching voor Blender</span><b>STUDIO-X · 2026</b></footer>
 </main>
}