(function(){
  const $=(id)=>document.getElementById(id);
  const dayNames={mon:'Monday',tue:'Tuesday',wed:'Wednesday',thu:'Thursday',fri:'Friday',sat:'Saturday',sun:'Sunday'};
  const btnWeek=$('btnViewWeek'),btnDay=$('btnViewDay'),weekWrapper=$('ttWeekWrapper'),dayWrapper=$('ttDayWrapper'),subtitle=$('ttSubtitle'),select=$('ttDay'),label=$('ttDayLabel'),weekTable=$('ttWeekTable'),dayBody=document.querySelector('#ttDayTable tbody');
  function selectedDay(){return select?.value&&select.value!=='auto'?select.value:(document.body.dataset.todayDay||'mon');}
  function tdFrom(source){const td=document.createElement('td');td.textContent=source?.textContent||'';return td;}
  function renderDay(){if(!dayBody||!weekTable)return;const day=selectedDay();if(label)label.textContent=dayNames[day]||'Today';dayBody.replaceChildren();let count=0;weekTable.querySelectorAll('tbody tr[data-day]').forEach((row)=>{if(row.dataset.day!==day)return;const cells=row.querySelectorAll('td');if(cells.length<5)return;const tr=document.createElement('tr');tr.append(tdFrom(cells[1]),tdFrom(cells[2]),tdFrom(cells[3]),tdFrom(cells[4]));dayBody.appendChild(tr);count+=1;});if(!count){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=4;td.textContent='No classes found for this day.';tr.appendChild(td);dayBody.appendChild(tr);}}
  btnWeek?.addEventListener('click',()=>{btnWeek.classList.add('active');btnDay?.classList.remove('active');if(weekWrapper)weekWrapper.style.display='';if(dayWrapper)dayWrapper.style.display='none';if(subtitle)subtitle.textContent='Week view (Mon–Sun)';});
  btnDay?.addEventListener('click',()=>{btnDay.classList.add('active');btnWeek?.classList.remove('active');if(weekWrapper)weekWrapper.style.display='none';if(dayWrapper)dayWrapper.style.display='';if(subtitle)subtitle.textContent='Day view';renderDay();});
  select?.addEventListener('change',renderDay);$('btnPrintTimetable')?.addEventListener('click',()=>window.print());renderDay();
})();
