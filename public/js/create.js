 
  const role = document.getElementById('role');
  const studentWrap = document.getElementById('studentWrap');
  const deptWrap = document.getElementById('deptWrap');
  const programId = document.getElementById('programId');

  function applyRoleUI(){
    const r = (role.value || '');
    if(r === 'student'){
      studentWrap.style.display = 'block';
      deptWrap.style.display = 'none';
      // ✅ required only when student
      programId.setAttribute('required','required');
    } else {
      studentWrap.style.display = 'none';
      deptWrap.style.display = 'block';
      programId.removeAttribute('required');
      // clear selection to avoid sending stale value
      if (programId) programId.value = "";
    }
  }

  role.addEventListener('change', applyRoleUI);
  applyRoleUI();
