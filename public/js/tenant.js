 
    const initialCampuses = (() => { try { return JSON.parse(`<%- JSON.stringify(old?.campusesJson ? JSON.parse(old.campusesJson) : []) %>`); } catch(e) { return []; } })();
    const LEVEL_OPTIONS = ['Nursery','Kindergarten','Primary','Secondary','High School','A-Level','Vocational'];
    const SECTION_OPTIONS = ['Sciences','Arts','Commerce','Humanities','General'];
    const campusList = document.getElementById('campusList');
    const campusesJson = document.getElementById('campusesJson');

    function esc(v){ return String(v || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
    function uid(){ return Math.random().toString(36).slice(2,10); }
    function defaultCampus(){ return {id:uid(),name:'',code:'',city:'',address:'',phone:'',isActive:true,open:true,levels:[]}; }
    function defaultLevel(){ return {id:uid(),name:'',isActive:true,open:true,sections:[]}; }
    function defaultSection(name=''){ return {id:uid(),name,isActive:true}; }
    let campuses = initialCampuses.length ? initialCampuses.map(c => ({...c,id:uid(),open:true,levels:(c.levels||[]).map(l=>({...l,id:uid(),open:true,sections:(l.sections||[]).map(s=>typeof s==='string'?defaultSection(s):{...s,id:uid()})}))})) : [defaultCampus()];

    function sync(){ campusesJson.value = JSON.stringify(campuses.map(c => ({name:c.name,code:c.code,city:c.city,address:c.address,phone:c.phone,isActive:!!c.isActive,levels:(c.levels||[]).map(l => ({name:l.name,isActive:!!l.isActive,sections:(l.sections||[]).map(s => ({name:s.name,isActive:!!s.isActive}))}))}))); }
    function sectionPills(sections){ return (sections||[]).filter(s=>s.name).map(s => `<span class="pill">${esc(s.name)}${s.isActive===false?' · Inactive':''}</span>`).join('') || '<span class="muted">No sections yet</span>'; }
    function render(){
      sync();
      campusList.innerHTML = campuses.length ? campuses.map((campus, ci) => `
        <div class="campus-card">
          <div class="campus-head" onclick="toggleCampus(${ci})">
            <div>
              <div class="campus-title">${esc(campus.name || 'New Campus')}</div>
              <div class="muted">${esc(campus.city || 'No city yet')} · ${(campus.levels||[]).length} levels · ${campus.isActive===false?'Inactive':'Active'}</div>
            </div>
            <div class="toolbar">
              <button type="button" class="btn" onclick="event.stopPropagation();addLevel(${ci})"><i class="fa-solid fa-plus"></i> Add Level</button>
              <button type="button" class="btn danger" onclick="event.stopPropagation();removeCampus(${ci})"><i class="fa-solid fa-trash"></i></button>
            </div>
          </div>
          <div class="panel ${campus.open ? 'open' : ''}">
            <div class="grid">
              <div class="group"><label>Campus Name</label><input value="${esc(campus.name)}" oninput="setCampus(${ci},'name',this.value)"></div>
              <div class="group"><label>Campus Code</label><input value="${esc(campus.code || '')}" oninput="setCampus(${ci},'code',this.value)"></div>
              <div class="group"><label>City / Branch</label><input value="${esc(campus.city)}" oninput="setCampus(${ci},'city',this.value)"></div>
              <div class="group"><label>Phone</label><input value="${esc(campus.phone)}" oninput="setCampus(${ci},'phone',this.value)"></div>
              <div class="group full"><label>Address</label><input value="${esc(campus.address)}" oninput="setCampus(${ci},'address',this.value)"></div>
              <div class="group full"><label class="switch"><input type="checkbox" ${campus.isActive!==false?'checked':''} onchange="setCampusActive(${ci},this.checked)"> Campus Active</label></div>
            </div>
            <div class="stack" style="margin-top:14px">
              ${(campus.levels||[]).length ? campus.levels.map((level, li) => `
                <div class="level-card">
                  <div class="level-head" onclick="toggleLevel(${ci},${li})">
                    <div>
                      <div class="level-title">${esc(level.name || 'New Level')}</div>
                      <div class="pill-list" style="margin-top:6px">${sectionPills(level.sections)}</div>
                    </div>
                    <div class="toolbar">
                      <button type="button" class="btn" onclick="event.stopPropagation();addSection(${ci},${li})"><i class="fa-solid fa-plus"></i> Add Section</button>
                      <button type="button" class="btn danger" onclick="event.stopPropagation();removeLevel(${ci},${li})"><i class="fa-solid fa-trash"></i></button>
                    </div>
                  </div>
                  <div class="panel ${level.open ? 'open' : ''}">
                    <div class="grid">
                      <div class="group"><label>Level Name</label><input list="levelOptions" value="${esc(level.name)}" oninput="setLevel(${ci},${li},'name',this.value)"></div>
                      <div class="group"><label class="switch"><input type="checkbox" ${level.isActive!==false?'checked':''} onchange="setLevelActive(${ci},${li},this.checked)"> Level Active</label></div>
                      <div class="group full">
                        <label>Sections</label>
                        <div class="stack">${(level.sections||[]).map((section, si) => `
                          <div class="row">
                            <input list="sectionOptions" value="${esc(section.name)}" oninput="setSection(${ci},${li},${si},'name',this.value)" placeholder="Section name">
                            <label class="switch"><input type="checkbox" ${section.isActive!==false?'checked':''} onchange="setSectionActive(${ci},${li},${si},this.checked)"> Active</label>
                            <button type="button" class="btn danger" onclick="removeSection(${ci},${li},${si})"><i class="fa-solid fa-trash"></i></button>
                          </div>`).join('') || '<div class="empty">No sections yet for this level.</div>'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>`).join('') : '<div class="empty">No levels yet. Click Add Level.</div>'}
            </div>
          </div>
        </div>`).join('') : '<div class="empty">No campuses yet. Click Add Campus to start.</div>';
    }
    function setCampus(i,k,v){ campuses[i][k]=v; render(); }
    function setCampusActive(i,v){ campuses[i].isActive=v; render(); }
    function toggleCampus(i){ campuses[i].open=!campuses[i].open; render(); }
    function addCampus(){ campuses.push(defaultCampus()); render(); }
    function removeCampus(i){ campuses.splice(i,1); render(); }
    function addLevel(i){ campuses[i].open=true; campuses[i].levels.push(defaultLevel()); render(); }
    function removeLevel(i,j){ campuses[i].levels.splice(j,1); render(); }
    function toggleLevel(i,j){ campuses[i].levels[j].open=!campuses[i].levels[j].open; render(); }
    function setLevel(i,j,k,v){ campuses[i].levels[j][k]=v; render(); }
    function setLevelActive(i,j,v){ campuses[i].levels[j].isActive=v; render(); }
    function addSection(i,j){ campuses[i].levels[j].sections.push(defaultSection()); campuses[i].levels[j].open=true; render(); }
    function removeSection(i,j,k){ campuses[i].levels[j].sections.splice(k,1); render(); }
    function setSection(i,j,k,key,val){ campuses[i].levels[j].sections[k][key]=val; render(); }
    function setSectionActive(i,j,k,val){ campuses[i].levels[j].sections[k].isActive=val; render(); }
    document.getElementById('addCampusBtn').addEventListener('click', addCampus);
    window.toggleCampus=toggleCampus; window.addLevel=addLevel; window.removeCampus=removeCampus; window.removeLevel=removeLevel; window.toggleLevel=toggleLevel; window.setCampus=setCampus; window.setCampusActive=setCampusActive; window.setLevel=setLevel; window.setLevelActive=setLevelActive; window.addSection=addSection; window.removeSection=removeSection; window.setSection=setSection; window.setSectionActive=setSectionActive;
    render();
   