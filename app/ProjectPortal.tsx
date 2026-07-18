"use client";
import { FormEvent, useEffect, useMemo, useState } from "react";
import DroneFitApp from "./DroneFitApp";
export type ProjectRecord={id:string;code:string;name:string;stateJson:string;createdAt:string;updatedAt:string};
function BrandMark({small=false}:{small?:boolean}){return <span className={small?"xf-mark xf-small":"xf-mark"} aria-hidden="true"><i/><i/><i/><i/></span>}
export default function ProjectPortal(){
 const [projects,setProjects]=useState<ProjectRecord[]>([]),[current,setCurrent]=useState<ProjectRecord|null>(null),[loading,setLoading]=useState(true),[code,setCode]=useState("SX26259"),[name,setName]=useState("Tuiterd Holten"),[query,setQuery]=useState(""),[error,setError]=useState("");
 async function refresh(){setLoading(true);try{const r=await fetch("/api/projects");if(r.ok)setProjects(await r.json())}finally{setLoading(false)}}
 useEffect(()=>{refresh()},[]);
 async function create(e:FormEvent){e.preventDefault();setError("");const r=await fetch("/api/projects",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code,name,state:{projectName:name,site:{lat:52.282539407,lon:6.426162461},siteConfirmed:false,buildings:[]}})});const data=await r.json();if(!r.ok){setError(data.error??"Project kon niet worden gemaakt.");return}setCurrent(data);setProjects(p=>[data,...p])}
 async function remove(p:ProjectRecord){if(!confirm(p.code+" - "+p.name+" verwijderen?"))return;await fetch("/api/projects/"+p.id,{method:"DELETE"});setProjects(v=>v.filter(x=>x.id!==p.id))}
 const filtered=useMemo(()=>projects.filter(p=>(p.code+" "+p.name).toLowerCase().includes(query.toLowerCase())),[projects,query]);
 if(current)return <DroneFitApp key={current.id} project={current} onBack={()=>{setCurrent(null);refresh()}}/>;
 return <main className="project-home xdf-home">
  <header className="xdf-nav">
   <a className="xdf-logo" href="#top" aria-label="DroneFit home"><BrandMark/><span>Drone<b>Fit</b></span></a>
   <nav aria-label="Hoofdnavigatie"><a href="#werkwijze">Werkwijze</a><a href="#projecten">Projecten</a></nav>
   <span className="xdf-private"><i/>Prive projectomgeving</span>
  </header>
  <section className="xdf-hero" id="top">
   <div className="xdf-copy"><span className="xdf-kicker"><i/>Camera matching voor vastgoed</span><h1>Van dronefoto naar <em>overtuigende render.</em></h1><p>Positioneer nieuwbouw exact in de echte omgeving. DroneFit koppelt locatie, situatietekening en DJI-camera aan jouw Blender-model.</p><div className="xdf-actions"><a className="xdf-button" href="#projecten">Start een project <span>+</span></a><a className="xdf-textlink" href="#werkwijze">Bekijk hoe het werkt <span>↘</span></a></div><div className="xdf-proof"><strong>RD + NAP</strong><span>Exacte positie</span><strong>DJI EXIF</strong><span>Camera automatisch</span><strong>BLENDER</strong><span>Renderklaar export</span></div></div>
   <div className="xdf-demo" aria-label="Animatie van de DroneFit werkwijze">
    <div className="demo-head"><span>LIVE WORKFLOW</span><b>SX26259 / HOLTEN</b><i/></div>
    <div className="demo-canvas">
     <div className="demo-grid"/><div className="demo-road road-a"/><div className="demo-road road-b"/>
     <div className="demo-map-pin"><span/></div><div className="demo-boundary"><i/><i/><i/><i/></div>
     <div className="demo-drone"><BrandMark small/><span>DJI FC9313</span></div><div className="demo-frustum"/>
     <div className="demo-house house-a"><i/><b/></div><div className="demo-house house-b"><i/><b/></div><div className="demo-house house-c"><i/><b/></div><div className="demo-house house-d"><i/><b/></div>
     <div className="demo-render-wash"/><div className="demo-status"><i/><span>Camera match gereed</span><b>99.4%</b></div>
    </div>
    <div className="demo-timeline" id="werkwijze"><span><i/>Kaart</span><span><i/>Situatie</span><span><i/>Drone</span><span><i/>Woningen</span><span><i/>Render</span></div>
   </div>
  </section>
  <section className="xdf-flow"><span>01 <b>Zoek de locatie</b></span><span>02 <b>Lijn de situatie uit</b></span><span>03 <b>Upload de DJI-foto</b></span><span>04 <b>Plaats woningen</b></span><span>05 <b>Render in Blender</b></span></section>
  <section className="xdf-projects" id="projecten">
   <div className="xdf-section-head"><div><span>PROJECTOMGEVING</span><h2>Klaar om in te passen?</h2></div><p>Maak een nieuw SX-project of open een bestaand project. Alle camera-, kaart- en woningdata wordt automatisch opgeslagen.</p></div>
   <div className="project-grid xdf-project-grid">
    <form className="new-project-card xdf-new" onSubmit={create}><span className="card-kicker">+ NIEUW PROJECT</span><h2>Start een inpassing</h2><p>Gebruik dezelfde SX-code als in jullie projectmappen.</p><label>SX-projectnummer<input value={code} onChange={e=>setCode(e.target.value.toUpperCase())} placeholder="SX26259" pattern="SX[0-9]{4,}" required/></label><label>Locatie / projectnaam<input value={name} onChange={e=>setName(e.target.value)} placeholder="Tuiterd Holten" required/></label>{error&&<div className="form-error">{error}</div>}<button className="xdf-submit" type="submit">Project maken <span>↗</span></button></form>
    <div className="existing-projects xdf-existing"><div className="projects-head"><div><span className="card-kicker">BESTAANDE PROJECTEN</span><h2>Ga verder waar je was</h2></div><label className="xdf-search"><span>⌕</span><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Zoek SX of locatie..."/></label></div><div className="project-list">{loading?<div className="empty-projects"><i className="xdf-loader"/>Projecten laden...</div>:filtered.length===0?<div className="empty-projects"><b>Nog geen projecten</b><span>Maak hiernaast je eerste SX-project aan.</span></div>:filtered.map(p=>{let s:any={};try{s=JSON.parse(p.stateJson||"{}")}catch{}return <div className="project-item" key={p.id}><button className="project-open" onClick={()=>setCurrent(p)}><span className="project-code">{p.code}</span><span><b>{p.name}</b><small>{s.drone?"DJI-camera gekoppeld":"Locatie voorbereiden"} · {(s.buildings?.length??0)} woningblokken</small></span><time>{new Date(p.updatedAt).toLocaleDateString("nl-NL")}</time><i>↗</i></button><button className="delete-project" onClick={()=>remove(p)} aria-label="Verwijder project">×</button></div>})}</div></div>
   </div>
  </section>
  <footer className="xdf-footer"><a className="xdf-logo" href="#top"><BrandMark small/><span>Drone<b>Fit</b></span></a><span>Vastgoed camera matching voor Blender</span><b>STUDIO-X · 2026</b></footer>
 </main>
}