(function () {
  const DEFAULT_SCHOOL_TYPE_OPTIONS = ["private", "government", "faith-based", "international", "community", "other"];
  const DEFAULT_SCHOOL_CATEGORY_OPTIONS = ["nursery", "primary", "secondary", "mixed"];
  const DEFAULT_LEVEL_OPTIONS = ["baby", "middle", "top", "p1", "p2", "p3", "p4", "p5", "p6", "p7", "P8", "s1", "s2", "s3", "s4", "s5", "s6"];
  const DEFAULT_SECTION_OPTIONS = ["general", "a", "b", "c", "arts", "sciences", "commerce", "humanities"];

  function q(id) { return document.getElementById(id); }
  function trim(v) { return String(v || "").trim(); }
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
  function makeNode(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = String(text);
    return el;
  }
  function applyData(el, data) {
    Object.keys(data || {}).forEach(function (key) {
      const value = data[key];
      if (value === undefined || value === null || Number.isNaN(value)) return;
      el.dataset[key] = String(value);
    });
    return el;
  }
  function addIcon(parent, iconClass) {
    const icon = makeNode('i', 'fa-solid ' + iconClass);
    icon.setAttribute('aria-hidden', 'true');
    parent.appendChild(icon);
    return icon;
  }
  function makeButton(label, iconClass, className, action, data, disabled, ariaLabel) {
    const btn = makeNode('button', className || 'btn');
    btn.type = 'button';
    if (action) btn.dataset.action = action;
    applyData(btn, data);
    if (disabled) btn.disabled = true;
    if (ariaLabel) btn.setAttribute('aria-label', ariaLabel);
    if (iconClass) addIcon(btn, iconClass);
    if (label) btn.appendChild(document.createTextNode((iconClass ? ' ' : '') + label));
    return btn;
  }
  function makeGroup(labelText, control, extraClass) {
    const group = makeNode('div', 'group' + (extraClass ? ' ' + extraClass : ''));
    group.appendChild(makeNode('label', '', labelText));
    group.appendChild(control);
    return group;
  }
  function makeInput(value, field, data, placeholder) {
    const input = makeNode('input');
    input.value = value == null ? '' : String(value);
    if (field) input.dataset.field = field;
    applyData(input, data);
    if (placeholder) input.placeholder = placeholder;
    return input;
  }
  function addOption(select, value, label, selected) {
    const option = makeNode('option', '', label);
    option.value = value;
    option.selected = !!selected;
    select.appendChild(option);
  }
  function makeChoiceSelect(currentValue, options, placeholder, field, data) {
    const select = makeNode('select');
    if (field) select.dataset.field = field;
    applyData(select, data);
    const current = trim(currentValue);
    const isCustom = !!(current && options.indexOf(current) === -1);
    addOption(select, '', placeholder, !current);
    options.forEach(function (option) {
      addOption(select, option, option.toUpperCase(), current === option);
    });
    addOption(select, '__custom__', 'Custom', isCustom);
    return select;
  }
  function makeStatusSelect(isActive, field, data) {
    const select = makeNode('select');
    select.dataset.field = field;
    applyData(select, data);
    addOption(select, 'active', 'Active', isActive !== false);
    addOption(select, 'inactive', 'Inactive', isActive === false);
    return select;
  }
  function makeBooleanSelect(value, field, data) {
    const select = makeNode('select');
    select.dataset.field = field;
    applyData(select, data);
    addOption(select, 'true', 'Yes', value === true);
    addOption(select, 'false', 'No', value !== true);
    return select;
  }
  function makeEmpty(message, compact) {
    return makeNode('div', 'empty' + (compact ? ' compact' : ''), message);
  }
  function makeSummaryToggle(title, subtitle, open, action, data) {
    const button = makeNode('button', 'campus-toggle');
    button.type = 'button';
    button.dataset.action = action;
    applyData(button, data);
    const iconWrap = makeNode('span', 'campus-toggle-icon');
    addIcon(iconWrap, open ? 'fa-chevron-down' : 'fa-chevron-right');
    button.appendChild(iconWrap);
    const copy = makeNode('span');
    copy.appendChild(makeNode('span', 'campus-title', title));
    copy.appendChild(makeNode('span', 'muted block', subtitle));
    button.appendChild(copy);
    return button;
  }
  function unitNode(unit, unitIndex, totalUnits) {
    const card = makeNode('div', 'campus-card');
    const head = makeNode('div', 'campus-head');
    head.appendChild(makeSummaryToggle(
      unit.name || ('School Unit ' + (unitIndex + 1)),
      unit.category + ' · ' + unit.schoolType + ' · ' + ensureArray(unit.campuses).length + ' campuses · ' + activeLabel(unit.isActive),
      unit.open,
      'toggle-school-unit',
      { unitIndex: unitIndex }
    ));
    const toolbar = makeNode('div', 'toolbar');
    toolbar.appendChild(makeButton('Add Campus', 'fa-plus', 'btn', 'add-campus', { unitIndex: unitIndex }));
    toolbar.appendChild(makeButton('', 'fa-arrow-up', 'btn icon-btn', 'move-school-unit-up', { unitIndex: unitIndex }, unitIndex === 0, 'Move school unit up'));
    toolbar.appendChild(makeButton('', 'fa-arrow-down', 'btn icon-btn', 'move-school-unit-down', { unitIndex: unitIndex }, unitIndex === totalUnits - 1, 'Move school unit down'));
    toolbar.appendChild(makeButton('', 'fa-trash', 'btn danger icon-btn', 'delete-school-unit', { unitIndex: unitIndex }, false, 'Delete school unit'));
    head.appendChild(toolbar);
    card.appendChild(head);

    const panel = makeNode('div', 'panel' + (unit.open ? ' open' : ''));
    const grid = makeNode('div', 'grid compact-grid');
    grid.appendChild(makeGroup('School Unit Name', makeInput(unit.name, 'unit-name', { unitIndex: unitIndex })));
    grid.appendChild(makeGroup('Code', makeInput(unit.code, 'unit-code', { unitIndex: unitIndex })));
    grid.appendChild(makeGroup('Slug', makeInput(unit.slug, 'unit-slug', { unitIndex: unitIndex })));

    const customSchoolType = DEFAULT_SCHOOL_TYPE_OPTIONS.indexOf(unit.schoolType) === -1;
    grid.appendChild(makeGroup('School Type', makeChoiceSelect(unit.schoolType, DEFAULT_SCHOOL_TYPE_OPTIONS, 'Select school type', 'unit-school-type', { unitIndex: unitIndex })));
    grid.appendChild(makeGroup('Custom School Type', makeInput(customSchoolType ? unit.schoolType : '', 'unit-school-type-custom', { unitIndex: unitIndex }), customSchoolType ? '' : 'hidden'));

    const customCategory = DEFAULT_SCHOOL_CATEGORY_OPTIONS.indexOf(unit.category) === -1;
    grid.appendChild(makeGroup('Category', makeChoiceSelect(unit.category, DEFAULT_SCHOOL_CATEGORY_OPTIONS, 'Select category', 'unit-category', { unitIndex: unitIndex })));
    grid.appendChild(makeGroup('Custom Category', makeInput(customCategory ? unit.category : '', 'unit-category-custom', { unitIndex: unitIndex }), customCategory ? '' : 'hidden'));
    grid.appendChild(makeGroup('Status', makeStatusSelect(unit.isActive, 'unit-status', { unitIndex: unitIndex })));
    panel.appendChild(grid);

    const note = makeNode('div', 'inline-note');
    addIcon(note, 'fa-wand-magic-sparkles');
    note.appendChild(makeNode('div', '', 'Automation: first campus becomes main campus, category can prefill levels, and levels can prefill default sections.'));
    panel.appendChild(note);

    const campusesWrap = makeNode('div', 'levels-wrap');
    if (ensureArray(unit.campuses).length) {
      unit.campuses.forEach(function (campus, campusIndex) {
        campusesWrap.appendChild(campusNode(campus, unit, unitIndex, campusIndex, unit.campuses.length));
      });
    } else {
      campusesWrap.appendChild(makeEmpty('No campuses yet.'));
    }
    panel.appendChild(campusesWrap);
    card.appendChild(panel);
    return card;
  }
  function campusNode(campus, unit, unitIndex, campusIndex, totalCampuses) {
    const card = makeNode('div', 'campus-card');
    const head = makeNode('div', 'campus-head');
    const subtitle = (campus.city || 'No city yet') + ' · ' + ensureArray(campus.levels).length + ' levels · ' + activeLabel(campus.isActive) + (campus.isMain ? ' · Main campus' : '');
    head.appendChild(makeSummaryToggle(campus.name, subtitle, campus.open, 'toggle-campus', { unitIndex: unitIndex, campusIndex: campusIndex }));
    const toolbar = makeNode('div', 'toolbar');
    toolbar.appendChild(makeButton('Add Level', 'fa-plus', 'btn', 'add-level', { unitIndex: unitIndex, campusIndex: campusIndex }));
    toolbar.appendChild(makeButton('', 'fa-arrow-up', 'btn icon-btn', 'move-campus-up', { unitIndex: unitIndex, campusIndex: campusIndex }, campusIndex === 0, 'Move campus up'));
    toolbar.appendChild(makeButton('', 'fa-arrow-down', 'btn icon-btn', 'move-campus-down', { unitIndex: unitIndex, campusIndex: campusIndex }, campusIndex === totalCampuses - 1, 'Move campus down'));
    toolbar.appendChild(makeButton('', 'fa-trash', 'btn danger icon-btn', 'delete-campus', { unitIndex: unitIndex, campusIndex: campusIndex }, false, 'Delete campus'));
    head.appendChild(toolbar);
    card.appendChild(head);

    const panel = makeNode('div', 'panel' + (campus.open ? ' open' : ''));
    const grid = makeNode('div', 'grid compact-grid');
    const data = { unitIndex: unitIndex, campusIndex: campusIndex };
    grid.appendChild(makeGroup('Campus Name', makeInput(campus.name, 'campus-name', data)));
    grid.appendChild(makeGroup('Campus Code', makeInput(campus.code, 'campus-code', data)));
    grid.appendChild(makeGroup('Main Campus', makeBooleanSelect(campus.isMain, 'campus-main', data)));
    grid.appendChild(makeGroup('City', makeInput(campus.city, 'campus-city', data)));
    grid.appendChild(makeGroup('District', makeInput(campus.district, 'campus-district', data)));
    grid.appendChild(makeGroup('Country', makeInput(campus.country, 'campus-country', data)));
    grid.appendChild(makeGroup('Phone', makeInput(campus.contactPhone, 'campus-phone', data)));
    grid.appendChild(makeGroup('Email', makeInput(campus.contactEmail, 'campus-email', data)));
    grid.appendChild(makeGroup('Status', makeStatusSelect(campus.isActive, 'campus-status', data)));
    grid.appendChild(makeGroup('Address', makeInput(campus.address, 'campus-address', data), 'full'));
    panel.appendChild(grid);

    const levelsWrap = makeNode('div', 'levels-wrap');
    const levelOptions = getDefaultLevelsByCategory(unit.category);
    if (ensureArray(campus.levels).length) {
      campus.levels.forEach(function (level, levelIndex) {
        levelsWrap.appendChild(levelNode(level, unit, unitIndex, campusIndex, levelIndex, levelOptions, campus.levels.length));
      });
    } else {
      levelsWrap.appendChild(makeEmpty('No levels yet.'));
    }
    panel.appendChild(levelsWrap);
    card.appendChild(panel);
    return card;
  }
  function levelNode(level, unit, unitIndex, campusIndex, levelIndex, levelOptions, totalLevels) {
    const card = makeNode('div', 'level-card');
    const top = makeNode('div', 'level-card-top');
    const titleWrap = makeNode('div');
    titleWrap.appendChild(makeNode('div', 'level-title', 'Level ' + (levelIndex + 1)));
    titleWrap.appendChild(makeNode('div', 'muted', (level.name || 'Not selected') + ' · ' + ensureArray(level.sections).length + ' sections · ' + activeLabel(level.isActive)));
    top.appendChild(titleWrap);
    const toolbar = makeNode('div', 'toolbar');
    const data = { unitIndex: unitIndex, campusIndex: campusIndex, levelIndex: levelIndex };
    toolbar.appendChild(makeButton('', 'fa-arrow-up', 'btn icon-btn', 'move-level-up', data, levelIndex === 0, 'Move level up'));
    toolbar.appendChild(makeButton('', 'fa-arrow-down', 'btn icon-btn', 'move-level-down', data, levelIndex === totalLevels - 1, 'Move level down'));
    toolbar.appendChild(makeButton('', 'fa-trash', 'btn danger icon-btn', 'delete-level', data, false, 'Delete level'));
    top.appendChild(toolbar);
    card.appendChild(top);

    const grid = makeNode('div', 'grid compact-grid');
    const customLevel = !!(trim(level.name) && levelOptions.indexOf(level.name) === -1);
    grid.appendChild(makeGroup('Level', makeChoiceSelect(level.name, levelOptions, 'Select level', 'level-name-select', data)));
    grid.appendChild(makeGroup('Custom Level Name', makeInput(customLevel ? level.name : '', 'level-name-custom', data, 'Example: S3'), customLevel ? '' : 'hidden'));
    grid.appendChild(makeGroup('Status', makeStatusSelect(level.isActive, 'level-status', data)));
    card.appendChild(grid);

    const sectionsGroup = makeNode('div', 'group');
    sectionsGroup.style.marginTop = '14px';
    sectionsGroup.appendChild(makeNode('label', '', 'Sections'));
    const addBar = makeNode('div', 'section-add-bar');
    const newSectionSelect = makeChoiceSelect('', DEFAULT_SECTION_OPTIONS, 'Select section', '', {});
    newSectionSelect.className = 'js-new-section-select';
    addBar.appendChild(newSectionSelect);
    const customSection = makeInput('', '', {}, 'Custom section name');
    customSection.className = 'js-new-section-custom hidden';
    addBar.appendChild(customSection);
    addBar.appendChild(makeButton('Add Section', 'fa-plus', 'btn', 'add-section', data));
    addBar.appendChild(makeButton('Defaults', 'fa-wand-magic-sparkles', 'btn', 'fill-default-sections', data));
    sectionsGroup.appendChild(addBar);
    const sectionsStack = makeNode('div', 'sections-stack');
    if (ensureArray(level.sections).length) {
      level.sections.forEach(function (section, sectionIndex) {
        sectionsStack.appendChild(sectionNode(section, unitIndex, campusIndex, levelIndex, sectionIndex));
      });
    } else {
      sectionsStack.appendChild(makeEmpty('No sections yet for this level.', true));
    }
    sectionsGroup.appendChild(sectionsStack);
    card.appendChild(sectionsGroup);
    return card;
  }
  function sectionNode(section, unitIndex, campusIndex, levelIndex, sectionIndex) {
    const row = makeNode('div', 'section-row');
    const name = makeNode('div', 'section-name');
    addIcon(name, 'fa-tag');
    name.appendChild(document.createTextNode(' ' + section.name));
    row.appendChild(name);
    const actions = makeNode('div', 'section-actions');
    const data = { unitIndex: unitIndex, campusIndex: campusIndex, levelIndex: levelIndex, sectionIndex: sectionIndex };
    actions.appendChild(makeStatusSelect(section.isActive, 'section-status', data));
    actions.appendChild(makeButton('', 'fa-trash', 'btn danger icon-btn', 'delete-section', data, false, 'Delete section'));
    row.appendChild(actions);
    return row;
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
    const nodes = state.schoolUnits.length
      ? state.schoolUnits.map(function (unit, unitIndex) { return unitNode(unit, unitIndex, state.schoolUnits.length); })
      : [makeEmpty('No school units yet. Add one to start the structure.')];
    list.replaceChildren.apply(list, nodes);
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
