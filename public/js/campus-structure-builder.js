(function () {
  const DEFAULT_SCHOOL_TYPE_OPTIONS = ["private", "government", "faith-based", "international", "community", "other"];
  const DEFAULT_SCHOOL_CATEGORY_OPTIONS = ["nursery", "primary", "secondary", "mixed"];
  const DEFAULT_LEVEL_OPTIONS = ["baby", "middle", "top", "p1", "p2", "p3", "p4", "p5", "p6", "p7", "P8", "s1", "s2", "s3", "s4", "s5", "s6"];
  const DEFAULT_SECTION_OPTIONS = ["general", "a", "b", "c", "arts", "sciences", "commerce", "humanities"];

  function q(id) { return document.getElementById(id); }
  function trim(v) { return String(v || "").trim(); }
  function esc(v) { return String(v || "").replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]; }); }
  function slugify(v) { return trim(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
  function activeLabel(v) { return v === false ? 'Inactive' : 'Active'; }
  function ensureArray(v) { return Array.isArray(v) ? v : []; }
  function uniqueByName(items) {
    const seen = new Set();
    return (items || []).filter(function (item) {
      const key = trim(item && item.name).toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  function selectOptions(currentValue, options, placeholder) {
    const current = trim(currentValue);
    const isCustom = current && options.indexOf(current) === -1;
    return ['<option value="">' + esc(placeholder) + '</option>']
      .concat(options.map(function (option) {
        return '<option value="' + esc(option) + '" ' + (current === option ? 'selected' : '') + '>' + esc(option.toUpperCase()) + '</option>';
      }))
      .concat(['<option value="__custom__" ' + (isCustom ? 'selected' : '') + '>Custom</option>'])
      .join('');
  }
  function toast(msg) {
    const el = q('campusBuilderToast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove('show'); }, 1800);
  }
  function getDefaultLevelsByCategory(category) {
    switch (trim(category).toLowerCase()) {
      case 'nursery': return ['baby', 'middle', 'top'];
      case 'primary': return ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', "P8"];
      case 'secondary': return ['s1', 's2', 's3', 's4', 's5', 's6'];
      case 'mixed':
      default: return DEFAULT_LEVEL_OPTIONS.slice();
    }
  }
  function getDefaultSections(levelName, category) {
    const level = trim(levelName).toLowerCase();
    const unitCategory = trim(category).toLowerCase();
    if (unitCategory === 'nursery' || ['baby', 'middle', 'top'].indexOf(level) !== -1) return ['general'];
    if (unitCategory === 'primary' || /^p[1-7]$/.test(level)) return ['a'];
    if (unitCategory === 'secondary' || /^s[1-6]$/.test(level)) return ['general'];
    return ['general'];
  }
  function makeSection(name, code, isActive) {
    const clean = trim(name);
    if (!clean) return null;
    return { name: clean, code: trim(code) || slugify(clean), isActive: isActive !== false };
  }
  function makeLevel(name, category, source) {
    const clean = trim(name);
    if (!clean) return null;
    const rawSections = uniqueByName(ensureArray(source && source.sections).map(function (item) {
      return makeSection(typeof item === 'string' ? item : item && item.name, item && item.code, !(item && item.isActive === false));
    }).filter(Boolean));
    const sections = rawSections.length ? rawSections : getDefaultSections(clean, category).map(function (sectionName) { return makeSection(sectionName); });
    return {
      name: clean,
      code: trim(source && source.code) || slugify(clean),
      isActive: !(source && source.isActive === false),
      sections: sections,
    };
  }
  function makeCampus(campus, unit, campusIndex) {
    const name = trim(campus && campus.name) || (campusIndex === 0 ? 'Main Campus' : ('Campus ' + (campusIndex + 1)));
    const rawLevels = uniqueByName(ensureArray(campus && campus.levels).map(function (level) {
      return makeLevel(level && level.name, unit.category, level);
    }).filter(Boolean));
    const levels = rawLevels.length ? rawLevels : getDefaultLevelsByCategory(unit.category).map(function (levelName) {
      return makeLevel(levelName, unit.category, null);
    });
    return {
      name: name,
      code: trim(campus && campus.code) || slugify(name),
      city: trim(campus && campus.city),
      district: trim(campus && campus.district),
      country: trim(campus && campus.country),
      address: trim(campus && campus.address),
      contactPhone: trim((campus && (campus.contactPhone || campus.phone)) || ''),
      contactEmail: trim((campus && (campus.contactEmail || campus.email)) || ''),
      schoolUnitName: unit.name,
      schoolUnitCode: unit.code,
      schoolUnitSlug: unit.slug,
      isMain: campusIndex === 0 ? true : !!(campus && campus.isMain === true),
      isActive: !(campus && campus.isActive === false),
      open: !(campus && campus.open === false),
      levels: levels,
    };
  }
  function makeUnit(unit, unitIndex) {
    const name = trim(unit && unit.name) || ('School Unit ' + (unitIndex + 1));
    const schoolType = trim(unit && (unit.schoolType || (unit.type && unit.type.schoolType))) || 'private';
    const category = trim(unit && (unit.category || (unit.type && unit.type.category))) || 'mixed';
    const normalized = {
      name: name,
      code: trim(unit && unit.code) || slugify(name),
      slug: trim(unit && unit.slug) || slugify(name),
      schoolType: schoolType,
      category: category,
      isActive: !(unit && unit.isActive === false),
      open: !(unit && unit.open === false),
      codeManuallySet: !!trim(unit && unit.code),
      slugManuallySet: !!trim(unit && unit.slug),
      campuses: [],
    };
    const rawCampuses = uniqueByName(ensureArray(unit && unit.campuses).map(function (campus, campusIndex) {
      return makeCampus(campus, normalized, campusIndex);
    }).filter(Boolean));
    normalized.campuses = rawCampuses.length ? rawCampuses : [makeCampus({ name: 'Main Campus', isMain: true }, normalized, 0)];
    normalized.campuses.forEach(function (campus, campusIndex) {
      campus.isMain = campusIndex === 0;
      campus.codeManuallySet = !!trim(unit && unit.campuses && unit.campuses[campusIndex] && unit.campuses[campusIndex].code);
    });
    return normalized;
  }
  function unitHtml(unit, unitIndex, totalUnits) {
    const campusesHtml = (unit.campuses || []).length
      ? unit.campuses.map(function (campus, campusIndex) { return campusHtml(campus, unit, unitIndex, campusIndex, unit.campuses.length); }).join('')
      : '<div class="empty">No campuses yet.</div>';
    const customSchoolType = DEFAULT_SCHOOL_TYPE_OPTIONS.indexOf(unit.schoolType) === -1;
    const customCategory = DEFAULT_SCHOOL_CATEGORY_OPTIONS.indexOf(unit.category) === -1;
    return '' +
      '<div class="campus-card">' +
        '<div class="campus-head">' +
          '<button type="button" class="campus-toggle" data-action="toggle-school-unit" data-unit-index="' + unitIndex + '">' +
            '<span class="campus-toggle-icon"><i class="fa-solid ' + (unit.open ? 'fa-chevron-down' : 'fa-chevron-right') + '"></i></span>' +
            '<span><span class="campus-title">' + esc(unit.name || ('School Unit ' + (unitIndex + 1))) + '</span><span class="muted block">' + esc(unit.category + ' · ' + unit.schoolType + ' · ' + (unit.campuses || []).length + ' campuses · ' + activeLabel(unit.isActive)) + '</span></span>' +
          '</button>' +
          '<div class="toolbar">' +
            '<button type="button" class="btn" data-action="add-campus" data-unit-index="' + unitIndex + '"><i class="fa-solid fa-plus"></i> Add Campus</button>' +
            '<button type="button" class="btn icon-btn" data-action="move-school-unit-up" data-unit-index="' + unitIndex + '" ' + (unitIndex === 0 ? 'disabled' : '') + '><i class="fa-solid fa-arrow-up"></i></button>' +
            '<button type="button" class="btn icon-btn" data-action="move-school-unit-down" data-unit-index="' + unitIndex + '" ' + (unitIndex === totalUnits - 1 ? 'disabled' : '') + '><i class="fa-solid fa-arrow-down"></i></button>' +
            '<button type="button" class="btn danger icon-btn" data-action="delete-school-unit" data-unit-index="' + unitIndex + '"><i class="fa-solid fa-trash"></i></button>' +
          '</div>' +
        '</div>' +
        '<div class="panel ' + (unit.open ? 'open' : '') + '">' +
          '<div class="grid compact-grid">' +
            '<div class="group"><label>School Unit Name</label><input value="' + esc(unit.name) + '" data-unit-index="' + unitIndex + '" data-field="unit-name"></div>' +
            '<div class="group"><label>Code</label><input value="' + esc(unit.code) + '" data-unit-index="' + unitIndex + '" data-field="unit-code"></div>' +
            '<div class="group"><label>Slug</label><input value="' + esc(unit.slug) + '" data-unit-index="' + unitIndex + '" data-field="unit-slug"></div>' +
            '<div class="group"><label>School Type</label><select data-unit-index="' + unitIndex + '" data-field="unit-school-type">' + selectOptions(unit.schoolType, DEFAULT_SCHOOL_TYPE_OPTIONS, 'Select school type') + '</select></div>' +
            '<div class="group ' + (customSchoolType ? '' : 'hidden') + '"><label>Custom School Type</label><input value="' + esc(customSchoolType ? unit.schoolType : '') + '" data-unit-index="' + unitIndex + '" data-field="unit-school-type-custom"></div>' +
            '<div class="group"><label>Category</label><select data-unit-index="' + unitIndex + '" data-field="unit-category">' + selectOptions(unit.category, DEFAULT_SCHOOL_CATEGORY_OPTIONS, 'Select category') + '</select></div>' +
            '<div class="group ' + (customCategory ? '' : 'hidden') + '"><label>Custom Category</label><input value="' + esc(customCategory ? unit.category : '') + '" data-unit-index="' + unitIndex + '" data-field="unit-category-custom"></div>' +
            '<div class="group"><label>Status</label><select data-unit-index="' + unitIndex + '" data-field="unit-status"><option value="active" ' + (unit.isActive !== false ? 'selected' : '') + '>Active</option><option value="inactive" ' + (unit.isActive === false ? 'selected' : '') + '>Inactive</option></select></div>' +
          '</div>' +
          '<div class="inline-note"><i class="fa-solid fa-wand-magic-sparkles"></i><div>Automation: first campus becomes main campus, category can prefill levels, and levels can prefill default sections.</div></div>' +
          '<div class="levels-wrap">' + campusesHtml + '</div>' +
        '</div>' +
      '</div>';
  }
  function campusHtml(campus, unit, unitIndex, campusIndex, totalCampuses) {
    const levelOptions = getDefaultLevelsByCategory(unit.category);
    const levelsHtml = (campus.levels || []).length
      ? campus.levels.map(function (level, levelIndex) { return levelHtml(level, unit, unitIndex, campusIndex, levelIndex, levelOptions, campus.levels.length); }).join('')
      : '<div class="empty">No levels yet.</div>';
    return '' +
      '<div class="campus-card">' +
        '<div class="campus-head">' +
          '<button type="button" class="campus-toggle" data-action="toggle-campus" data-unit-index="' + unitIndex + '" data-campus-index="' + campusIndex + '">' +
            '<span class="campus-toggle-icon"><i class="fa-solid ' + (campus.open ? 'fa-chevron-down' : 'fa-chevron-right') + '"></i></span>' +
            '<span><span class="campus-title">' + esc(campus.name) + '</span><span class="muted block">' + esc((campus.city || 'No city yet') + ' · ' + (campus.levels || []).length + ' levels · ' + activeLabel(campus.isActive) + (campus.isMain ? ' · Main campus' : '')) + '</span></span>' +
          '</button>' +
          '<div class="toolbar">' +
            '<button type="button" class="btn" data-action="add-level" data-unit-index="' + unitIndex + '" data-campus-index="' + campusIndex + '"><i class="fa-solid fa-plus"></i> Add Level</button>' +
            '<button type="button" class="btn icon-btn" data-action="move-campus-up" data-unit-index="' + unitIndex + '" data-campus-index="' + campusIndex + '" ' + (campusIndex === 0 ? 'disabled' : '') + '><i class="fa-solid fa-arrow-up"></i></button>' +
            '<button type="button" class="btn icon-btn" data-action="move-campus-down" data-unit-index="' + unitIndex + '" data-campus-index="' + campusIndex + '" ' + (campusIndex === totalCampuses - 1 ? 'disabled' : '') + '><i class="fa-solid fa-arrow-down"></i></button>' +
            '<button type="button" class="btn danger icon-btn" data-action="delete-campus" data-unit-index="' + unitIndex + '" data-campus-index="' + campusIndex + '"><i class="fa-solid fa-trash"></i></button>' +
          '</div>' +
        '</div>' +
        '<div class="panel ' + (campus.open ? 'open' : '') + '">' +
          '<div class="grid compact-grid">' +
            '<div class="group"><label>Campus Name</label><input value="' + esc(campus.name) + '" data-unit-index="' + unitIndex + '" data-campus-index="' + campusIndex + '" data-field="campus-name"></div>' +
            '<div class="group"><label>Campus Code</label><input value="' + esc(campus.code) + '" data-unit-index="' + unitIndex + '" data-campus-index="' + campusIndex + '" data-field="campus-code"></div>' +
            '<div class="group"><label>Main Campus</label><select data-unit-index="' + unitIndex + '" data-campus-index="' + campusIndex + '" data-field="campus-main"><option value="true" ' + (campus.isMain ? 'selected' : '') + '>Yes</option><option value="false" ' + (!campus.isMain ? 'selected' : '') + '>No</option></select></div>' +
            '<div class="group"><label>City</label><input value="' + esc(campus.city) + '" data-unit-index="' + unitIndex + '" data-campus-index="' + campusIndex + '" data-field="campus-city"></div>' +
            '<div class="group"><label>District</label><input value="' + esc(campus.district) + '" data-unit-index="' + unitIndex + '" data-campus-index="' + campusIndex + '" data-field="campus-district"></div>' +
            '<div class="group"><label>Country</label><input value="' + esc(campus.country) + '" data-unit-index="' + unitIndex + '" data-campus-index="' + campusIndex + '" data-field="campus-country"></div>' +
            '<div class="group"><label>Phone</label><input value="' + esc(campus.contactPhone) + '" data-unit-index="' + unitIndex + '" data-campus-index="' + campusIndex + '" data-field="campus-phone"></div>' +
            '<div class="group"><label>Email</label><input value="' + esc(campus.contactEmail) + '" data-unit-index="' + unitIndex + '" data-campus-index="' + campusIndex + '" data-field="campus-email"></div>' +
            '<div class="group"><label>Status</label><select data-unit-index="' + unitIndex + '" data-campus-index="' + campusIndex + '" data-field="campus-status"><option value="active" ' + (campus.isActive !== false ? 'selected' : '') + '>Active</option><option value="inactive" ' + (campus.isActive === false ? 'selected' : '') + '>Inactive</option></select></div>' +
            '<div class="group full"><label>Address</label><input value="' + esc(campus.address) + '" data-unit-index="' + unitIndex + '" data-campus-index="' + campusIndex + '" data-field="campus-address"></div>' +
          '</div>' +
          '<div class="levels-wrap">' + levelsHtml + '</div>' +
        '</div>' +
      '</div>';
  }
  function levelHtml(level, unit, unitIndex, campusIndex, levelIndex, levelOptions, totalLevels) {
    const customLevel = trim(level.name) && levelOptions.indexOf(level.name) === -1;
    const sectionOptions = DEFAULT_SECTION_OPTIONS.slice();
    const sectionsHtml = (level.sections || []).length
      ? level.sections.map(function (section, sectionIndex) { return sectionHtml(section, unitIndex, campusIndex, levelIndex, sectionIndex); }).join('')
      : '<div class="empty compact">No sections yet for this level.</div>';
    return '' +
      '<div class="level-card">' +
        '<div class="level-card-top">' +
          '<div><div class="level-title">Level ' + (levelIndex + 1) + '</div><div class="muted">' + esc(level.name || 'Not selected') + ' · ' + (level.sections || []).length + ' sections · ' + activeLabel(level.isActive) + '</div></div>' +
          '<div class="toolbar">' +
            '<button type="button" class="btn icon-btn" data-action="move-level-up" data-unit-index="' + unitIndex + '" data-campus-index="' + campusIndex + '" data-level-index="' + levelIndex + '" ' + (levelIndex === 0 ? 'disabled' : '') + '><i class="fa-solid fa-arrow-up"></i></button>' +
            '<button type="button" class="btn icon-btn" data-action="move-level-down" data-unit-index="' + unitIndex + '" data-campus-index="' + campusIndex + '" data-level-index="' + levelIndex + '" ' + (levelIndex === totalLevels - 1 ? 'disabled' : '') + '><i class="fa-solid fa-arrow-down"></i></button>' +
            '<button type="button" class="btn danger icon-btn" data-action="delete-level" data-unit-index="' + unitIndex + '" data-campus-index="' + campusIndex + '" data-level-index="' + levelIndex + '"><i class="fa-solid fa-trash"></i></button>' +
          '</div>' +
        '</div>' +
        '<div class="grid compact-grid">' +
          '<div class="group"><label>Level</label><select data-unit-index="' + unitIndex + '" data-campus-index="' + campusIndex + '" data-level-index="' + levelIndex + '" data-field="level-name-select">' + selectOptions(level.name, levelOptions, 'Select level') + '</select></div>' +
          '<div class="group ' + (customLevel ? '' : 'hidden') + '"><label>Custom Level Name</label><input value="' + esc(customLevel ? level.name : '') + '" placeholder="Example: S3" data-unit-index="' + unitIndex + '" data-campus-index="' + campusIndex + '" data-level-index="' + levelIndex + '" data-field="level-name-custom"></div>' +
          '<div class="group"><label>Status</label><select data-unit-index="' + unitIndex + '" data-campus-index="' + campusIndex + '" data-level-index="' + levelIndex + '" data-field="level-status"><option value="active" ' + (level.isActive !== false ? 'selected' : '') + '>Active</option><option value="inactive" ' + (level.isActive === false ? 'selected' : '') + '>Inactive</option></select></div>' +
        '</div>' +
        '<div class="group" style="margin-top:14px"><label>Sections</label><div class="section-add-bar"><select class="js-new-section-select">' + selectOptions('', sectionOptions, 'Select section') + '</select><input class="js-new-section-custom hidden" placeholder="Custom section name"><button type="button" class="btn" data-action="add-section" data-unit-index="' + unitIndex + '" data-campus-index="' + campusIndex + '" data-level-index="' + levelIndex + '"><i class="fa-solid fa-plus"></i> Add Section</button><button type="button" class="btn" data-action="fill-default-sections" data-unit-index="' + unitIndex + '" data-campus-index="' + campusIndex + '" data-level-index="' + levelIndex + '"><i class="fa-solid fa-wand-magic-sparkles"></i> Defaults</button></div><div class="sections-stack">' + sectionsHtml + '</div></div>' +
      '</div>';
  }
  function sectionHtml(section, unitIndex, campusIndex, levelIndex, sectionIndex) {
    return '' +
      '<div class="section-row">' +
        '<div class="section-name"><i class="fa-solid fa-tag"></i> ' + esc(section.name) + '</div>' +
        '<div class="section-actions">' +
          '<select data-unit-index="' + unitIndex + '" data-campus-index="' + campusIndex + '" data-level-index="' + levelIndex + '" data-section-index="' + sectionIndex + '" data-field="section-status"><option value="active" ' + (section.isActive !== false ? 'selected' : '') + '>Active</option><option value="inactive" ' + (section.isActive === false ? 'selected' : '') + '>Inactive</option></select>' +
          '<button type="button" class="btn danger icon-btn" data-action="delete-section" data-unit-index="' + unitIndex + '" data-campus-index="' + campusIndex + '" data-level-index="' + levelIndex + '" data-section-index="' + sectionIndex + '"><i class="fa-solid fa-trash"></i></button>' +
        '</div>' +
      '</div>';
  }
  function syncUnitLinks(unit) {
    unit.code = trim(unit.code) || slugify(unit.name);
    unit.slug = trim(unit.slug) || slugify(unit.name);
    ensureArray(unit.campuses).forEach(function (campus, index) {
      campus.schoolUnitName = unit.name;
      campus.schoolUnitCode = unit.code;
      campus.schoolUnitSlug = unit.slug;
      campus.isMain = index === 0 ? true : !!campus.isMain;
      if (!campus.codeManuallySet) campus.code = slugify(campus.name || ('campus-' + (index + 1)));
      ensureArray(campus.levels).forEach(function (level) {
        if (!trim(level.code)) level.code = slugify(level.name);
        ensureArray(level.sections).forEach(function (section) {
          if (!trim(section.code)) section.code = slugify(section.name);
        });
      });
    });
  }
  function serialize() {
    state.schoolUnits.forEach(syncUnitLinks);
    if (hiddenInput) hiddenInput.value = JSON.stringify(state.schoolUnits.map(function (unit) {
      return {
        name: unit.name,
        code: unit.code,
        slug: unit.slug,
        schoolType: unit.schoolType,
        category: unit.category,
        isActive: unit.isActive,
        campuses: ensureArray(unit.campuses).map(function (campus) {
          return {
            name: campus.name,
            code: campus.code,
            city: campus.city,
            district: campus.district,
            country: campus.country,
            address: campus.address,
            contactPhone: campus.contactPhone,
            contactEmail: campus.contactEmail,
            schoolUnitName: campus.schoolUnitName,
            schoolUnitCode: campus.schoolUnitCode,
            schoolUnitSlug: campus.schoolUnitSlug,
            isMain: campus.isMain,
            isActive: campus.isActive,
            levels: ensureArray(campus.levels).map(function (level) {
              return {
                name: level.name,
                code: level.code,
                isActive: level.isActive,
                sections: ensureArray(level.sections).map(function (section) {
                  return { name: section.name, code: section.code, isActive: section.isActive };
                })
              };
            })
          };
        })
      };
    }));
    if (root.dataset.draftKey) {
      try { localStorage.setItem(root.dataset.draftKey, hiddenInput.value || '[]'); } catch (_) {}
    }
  }
  function render() {
    list.innerHTML = state.schoolUnits.length
      ? state.schoolUnits.map(function (unit, unitIndex) { return unitHtml(unit, unitIndex, state.schoolUnits.length); }).join('')
      : '<div class="empty">No school units yet. Add one to start the structure.</div>';
    serialize();
  }
  function swap(items, fromIndex, toIndex) {
    const item = items[fromIndex];
    items.splice(fromIndex, 1);
    items.splice(toIndex, 0, item);
  }
  function confirmRemove(message) { return window.confirm(message); }

  var root, list, hiddenInput, state;
  function init(config) {
    root = document.querySelector('[data-campus-builder-root]');
    list = q(config.listId);
    hiddenInput = q(config.hiddenInputId);
    state = {
      schoolUnits: uniqueByName(ensureArray(config.initialSchoolUnits).map(function (unit, unitIndex) { return makeUnit(unit, unitIndex); }).filter(Boolean))
    };
    if (!state.schoolUnits.length) state.schoolUnits = [makeUnit({ name: '', campuses: [] }, 0)];
    const addBtn = q(config.addBtnId);
    function addSchoolUnit() {
      state.schoolUnits.push(makeUnit({ name: '', campuses: [] }, state.schoolUnits.length));
      render();
      toast('School unit added');
    }
    if (addBtn) addBtn.addEventListener('click', function (e) { e.preventDefault(); addSchoolUnit(); });

    root.addEventListener('click', function (event) {
      const el = event.target.closest('[data-action]');
      if (!el) return;
      const action = el.getAttribute('data-action');
      const u = Number(el.getAttribute('data-unit-index'));
      const c = Number(el.getAttribute('data-campus-index'));
      const l = Number(el.getAttribute('data-level-index'));
      const s = Number(el.getAttribute('data-section-index'));
      if (action === 'toggle-school-unit') { state.schoolUnits[u].open = !state.schoolUnits[u].open; render(); return; }
      if (action === 'delete-school-unit') { if (!confirmRemove('Delete this school unit and everything under it?')) return; state.schoolUnits.splice(u, 1); render(); toast('School unit deleted'); return; }
      if (action === 'move-school-unit-up' && u > 0) { swap(state.schoolUnits, u, u - 1); render(); return; }
      if (action === 'move-school-unit-down' && u < state.schoolUnits.length - 1) { swap(state.schoolUnits, u, u + 1); render(); return; }
      if (action === 'add-campus') { state.schoolUnits[u].open = true; state.schoolUnits[u].campuses.push(makeCampus({ name: '' }, state.schoolUnits[u], state.schoolUnits[u].campuses.length)); syncUnitLinks(state.schoolUnits[u]); render(); toast('Campus added'); return; }
      if (action === 'toggle-campus') { state.schoolUnits[u].campuses[c].open = !state.schoolUnits[u].campuses[c].open; render(); return; }
      if (action === 'delete-campus') { if (!confirmRemove('Delete this campus and all levels and sections under it?')) return; state.schoolUnits[u].campuses.splice(c, 1); syncUnitLinks(state.schoolUnits[u]); render(); toast('Campus deleted'); return; }
      if (action === 'move-campus-up' && c > 0) { swap(state.schoolUnits[u].campuses, c, c - 1); syncUnitLinks(state.schoolUnits[u]); render(); return; }
      if (action === 'move-campus-down' && c < state.schoolUnits[u].campuses.length - 1) { swap(state.schoolUnits[u].campuses, c, c + 1); syncUnitLinks(state.schoolUnits[u]); render(); return; }
      if (action === 'add-level') { state.schoolUnits[u].campuses[c].open = true; state.schoolUnits[u].campuses[c].levels.push(makeLevel('', state.schoolUnits[u].category, { sections: [] }) || { name:'', code:'', isActive:true, sections:[] }); render(); toast('Level added'); return; }
      if (action === 'delete-level') { if (!confirmRemove('Delete this level and all sections under it?')) return; state.schoolUnits[u].campuses[c].levels.splice(l, 1); render(); toast('Level deleted'); return; }
      if (action === 'move-level-up' && l > 0) { swap(state.schoolUnits[u].campuses[c].levels, l, l - 1); render(); return; }
      if (action === 'move-level-down' && l < state.schoolUnits[u].campuses[c].levels.length - 1) { swap(state.schoolUnits[u].campuses[c].levels, l, l + 1); render(); return; }
      if (action === 'fill-default-sections') {
        var level = state.schoolUnits[u].campuses[c].levels[l];
        var defaults = getDefaultSections(level.name, state.schoolUnits[u].category);
        level.sections = uniqueByName(defaults.concat(ensureArray(level.sections).map(function (item) { return item.name; })).map(function (name) { return makeSection(typeof name === 'string' ? name : name.name); }).filter(Boolean));
        render();
        toast('Default sections added');
        return;
      }
      if (action === 'add-section') {
        var bar = el.closest('.section-add-bar');
        if (!bar) return;
        var selectEl = bar.querySelector('.js-new-section-select');
        var customEl = bar.querySelector('.js-new-section-custom');
        var raw = selectEl ? selectEl.value : '';
        var name = raw === '__custom__' ? trim(customEl && customEl.value) : trim(raw);
        if (!name) { window.alert('Select a section first.'); return; }
        var levelRef = state.schoolUnits[u].campuses[c].levels[l];
        if ((levelRef.sections || []).some(function (item) { return trim(item.name).toLowerCase() === name.toLowerCase(); })) { window.alert('That section already exists in this level.'); return; }
        levelRef.sections.push(makeSection(name));
        render();
        toast('Section added');
        return;
      }
      if (action === 'delete-section') { state.schoolUnits[u].campuses[c].levels[l].sections.splice(s, 1); render(); toast('Section deleted'); return; }
    });

    root.addEventListener('change', function (event) {
      var field = event.target.getAttribute('data-field');
      var u = Number(event.target.getAttribute('data-unit-index'));
      var c = Number(event.target.getAttribute('data-campus-index'));
      var l = Number(event.target.getAttribute('data-level-index'));
      var s = Number(event.target.getAttribute('data-section-index'));
      if (event.target.classList.contains('js-new-section-select')) {
        var bar = event.target.closest('.section-add-bar');
        var custom = bar && bar.querySelector('.js-new-section-custom');
        if (custom) {
          custom.classList.toggle('hidden', event.target.value !== '__custom__');
          if (event.target.value !== '__custom__') custom.value = '';
        }
        return;
      }
      if (!field) return;
      if (field === 'unit-status') { state.schoolUnits[u].isActive = event.target.value === 'active'; render(); return; }
      if (field === 'unit-school-type') { state.schoolUnits[u].schoolType = event.target.value === '__custom__' ? '' : event.target.value; render(); return; }
      if (field === 'unit-category') {
        state.schoolUnits[u].category = event.target.value === '__custom__' ? '' : event.target.value;
        state.schoolUnits[u].campuses.forEach(function (campus) {
          if (!ensureArray(campus.levels).length || window.confirm('Apply default levels for this category to existing campuses?')) {
            campus.levels = getDefaultLevelsByCategory(state.schoolUnits[u].category).map(function (levelName) { return makeLevel(levelName, state.schoolUnits[u].category, null); });
          }
        });
        render();
        return;
      }
      if (field === 'campus-status') { state.schoolUnits[u].campuses[c].isActive = event.target.value === 'active'; render(); return; }
      if (field === 'campus-main') { state.schoolUnits[u].campuses.forEach(function (campus, idx) { campus.isMain = idx === c ? event.target.value === 'true' : false; }); render(); return; }
      if (field === 'level-status') { state.schoolUnits[u].campuses[c].levels[l].isActive = event.target.value === 'active'; render(); return; }
      if (field === 'section-status') { state.schoolUnits[u].campuses[c].levels[l].sections[s].isActive = event.target.value === 'active'; serialize(); toast('Section status updated'); return; }
      if (field === 'level-name-select') {
        var nextName = event.target.value === '__custom__' ? '' : event.target.value;
        state.schoolUnits[u].campuses[c].levels[l].name = nextName;
        state.schoolUnits[u].campuses[c].levels[l].code = slugify(nextName);
        if (nextName) state.schoolUnits[u].campuses[c].levels[l].sections = getDefaultSections(nextName, state.schoolUnits[u].category).map(function (sectionName) { return makeSection(sectionName); });
        render();
        return;
      }
    });

    root.addEventListener('input', function (event) {
      var field = event.target.getAttribute('data-field');
      var u = Number(event.target.getAttribute('data-unit-index'));
      var c = Number(event.target.getAttribute('data-campus-index'));
      var l = Number(event.target.getAttribute('data-level-index'));
      if (!field) return;
      if (field === 'unit-name') {
        state.schoolUnits[u].name = event.target.value;
        if (!state.schoolUnits[u].codeManuallySet) state.schoolUnits[u].code = slugify(event.target.value);
        if (!state.schoolUnits[u].slugManuallySet) state.schoolUnits[u].slug = slugify(event.target.value);
        syncUnitLinks(state.schoolUnits[u]);
        serialize();
        return;
      }
      if (field === 'unit-code') { state.schoolUnits[u].codeManuallySet = true; state.schoolUnits[u].code = slugify(event.target.value); event.target.value = state.schoolUnits[u].code; syncUnitLinks(state.schoolUnits[u]); serialize(); return; }
      if (field === 'unit-slug') { state.schoolUnits[u].slugManuallySet = true; state.schoolUnits[u].slug = slugify(event.target.value); event.target.value = state.schoolUnits[u].slug; syncUnitLinks(state.schoolUnits[u]); serialize(); return; }
      if (field === 'unit-school-type-custom') { state.schoolUnits[u].schoolType = trim(event.target.value); serialize(); return; }
      if (field === 'unit-category-custom') { state.schoolUnits[u].category = trim(event.target.value); serialize(); return; }
      if (field === 'campus-name') {
        state.schoolUnits[u].campuses[c].name = event.target.value;
        if (!state.schoolUnits[u].campuses[c].codeManuallySet) state.schoolUnits[u].campuses[c].code = slugify(event.target.value);
        serialize();
        return;
      }
      if (field === 'campus-code') { state.schoolUnits[u].campuses[c].codeManuallySet = true; state.schoolUnits[u].campuses[c].code = slugify(event.target.value); event.target.value = state.schoolUnits[u].campuses[c].code; serialize(); return; }
      if (field === 'campus-city') { state.schoolUnits[u].campuses[c].city = event.target.value; serialize(); return; }
      if (field === 'campus-district') { state.schoolUnits[u].campuses[c].district = event.target.value; serialize(); return; }
      if (field === 'campus-country') { state.schoolUnits[u].campuses[c].country = event.target.value; serialize(); return; }
      if (field === 'campus-phone') { state.schoolUnits[u].campuses[c].contactPhone = event.target.value; serialize(); return; }
      if (field === 'campus-email') { state.schoolUnits[u].campuses[c].contactEmail = event.target.value; serialize(); return; }
      if (field === 'campus-address') { state.schoolUnits[u].campuses[c].address = event.target.value; serialize(); return; }
      if (field === 'level-name-custom') {
        state.schoolUnits[u].campuses[c].levels[l].name = event.target.value;
        state.schoolUnits[u].campuses[c].levels[l].code = slugify(event.target.value);
        serialize();
        return;
      }
    });

    var form = root.closest('form');
    if (form) form.addEventListener('submit', serialize);
    render();
  }

  function autoInit() {
    var root = document.querySelector('[data-campus-builder-root]');
    if (!root) return;
    var dataEl = q(root.dataset.initialDataId || 'campusBuilderData');
    var initialSchoolUnits = [];
    try {
      if (dataEl && dataEl.textContent) initialSchoolUnits = JSON.parse(dataEl.textContent || '[]');
      if ((!initialSchoolUnits || !initialSchoolUnits.length) && root.dataset.draftKey) {
        var draft = localStorage.getItem(root.dataset.draftKey);
        if (draft) initialSchoolUnits = JSON.parse(draft || '[]');
      }
    } catch (_) { initialSchoolUnits = []; }
    init({
      listId: root.id || 'campusList',
      hiddenInputId: root.dataset.hiddenInputId || 'schoolUnitsJson',
      addBtnId: root.dataset.addBtnId || 'addSchoolUnitBtn',
      initialSchoolUnits: initialSchoolUnits,
    });
  }

  window.ClassicAcademyStructureBuilder = { init: init, autoInit: autoInit };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoInit); else autoInit();
})();
