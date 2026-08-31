(function(){
  function apply(group,status){const hidden=group.querySelector('.row-status-value');if(hidden)hidden.value=status;group.querySelectorAll('.status-btn').forEach((btn)=>{btn.classList.remove('active-present','active-absent','active-late','active-excused');if(btn.dataset.status===status)btn.classList.add(`active-${status}`);});}
  document.querySelectorAll('[data-row-status]').forEach((group)=>group.addEventListener('click',(e)=>{const btn=e.target.closest('.status-btn');if(btn)apply(group,btn.dataset.status);}));
  function all(status){document.querySelectorAll('[data-row-status]').forEach((g)=>apply(g,status));}
  document.getElementById('markAllPresent')?.addEventListener('click',()=>all('present'));
  document.getElementById('markAllAbsent')?.addEventListener('click',()=>all('absent'));
  document.getElementById('markAllLate')?.addEventListener('click',()=>all('late'));
  document.getElementById('markAllExcused')?.addEventListener('click',()=>all('excused'));
})();
