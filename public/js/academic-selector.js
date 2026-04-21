(function () {
  const SELECTOR = "[data-academic-selector]";
  const initialized = new WeakSet();

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function readJson(id, fallback) {
    const el = document.getElementById(id);
    if (!el) return fallback;
    try {
      return JSON.parse(el.value || el.textContent || JSON.stringify(fallback));
    } catch (err) {
      console.error("Failed to parse academic selector JSON:", id, err);
      return fallback;
    }
  }

  function str(value) {
    return String(value ?? "").trim();
  }

  function idOf(item) {
    return str(item?.id || item?._id);
  }

  function labelOf(item, fallback) {
    return str(item?.label || item?.displayName || item?.name || item?.title || item?.code || fallback);
  }

  function classIdOf(item) {
    return str(item?.classId || item?.classGroup || item?.classGroupId);
  }

  function sectionIdOf(item) {
    return str(item?.sectionId);
  }

  function streamIdOf(item) {
    return str(item?.streamId);
  }

  function setOptions(select, items, placeholder, selectedValue, getLabel) {
    if (!select) return;
    const current = str(selectedValue ?? select.dataset.selected ?? select.value);
    const placeholderText = placeholder || select.dataset.placeholder || "Select";

    select.innerHTML = `<option value="">${escapeHtml(placeholderText)}</option>` + (items || []).map((item) => {
      const value = idOf(item);
      const label = getLabel ? getLabel(item) : labelOf(item, value || "Option");
      const selected = current && current === value ? " selected" : "";
      return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(label)}</option>`;
    }).join("");

    if (current && select.value !== current) select.value = "";
  }

  function sameOrEmpty(left, right) {
    const a = str(left);
    const b = str(right);
    return !a || !b || a === b;
  }

  function initScope(scope) {
    if (!scope || initialized.has(scope)) return;
    initialized.add(scope);

    const data = {
      classes: readJson(scope.dataset.classes || "classesData", []),
      sections: readJson(scope.dataset.sections || "sectionsData", []),
      streams: readJson(scope.dataset.streams || "streamsData", []),
      subjects: readJson(scope.dataset.subjects || "subjectOptionsData", []),
      students: readJson(scope.dataset.students || "studentsData", []),
    };

    const controls = {
      class: scope.querySelector('[data-role="class"]'),
      section: scope.querySelector('[data-role="section"]'),
      stream: scope.querySelector('[data-role="stream"]'),
      subject: scope.querySelector('[data-role="subject"]'),
      student: scope.querySelector('[data-role="student"]'),
      academicYear: scope.querySelector('[data-role="academicYear"]'),
      term: scope.querySelector('[data-role="term"]'),
    };

    if (!controls.class && !controls.section && !controls.stream && !controls.subject && !controls.student) return;

    function selected() {
      return {
        classId: str(controls.class?.value),
        sectionId: str(controls.section?.value),
        streamId: str(controls.stream?.value),
        subjectId: str(controls.subject?.value),
        studentId: str(controls.student?.value),
      };
    }

    function classLabel(item) {
      return [
        item.name || item.title || item.code || "Class",
        item.classLevel ? `(${item.classLevel})` : "",
        item.academicYear || "",
      ].filter(Boolean).join(" ");
    }

    function subjectLabel(item) {
      return item.label || [item.code, item.title || item.shortTitle].filter(Boolean).join(" - ") || "Subject";
    }

    function studentLabel(item) {
      return item.label || [item.regNo || item.studentNo || item.indexNumber, item.fullName || item.name].filter(Boolean).join(" - ") || "Student";
    }

    function refresh() {
      const current = selected();

      if (controls.class && controls.class.dataset.manageClass !== "false") {
        setOptions(controls.class, data.classes, controls.class.dataset.placeholder || "Select Class", current.classId, classLabel);
      }

      const afterClass = selected();

      if (controls.section) {
        const sections = data.sections.filter((item) => sameOrEmpty(classIdOf(item), afterClass.classId));
        setOptions(controls.section, sections, controls.section.dataset.placeholder || "All Sections", current.sectionId);
      }

      const afterSection = selected();

      if (controls.stream) {
        const streams = data.streams.filter((item) => (
          sameOrEmpty(classIdOf(item), afterSection.classId) &&
          (!afterSection.sectionId || !sectionIdOf(item) || sectionIdOf(item) === afterSection.sectionId)
        ));
        setOptions(controls.stream, streams, controls.stream.dataset.placeholder || "All Streams", current.streamId);
      }

      const afterStream = selected();

      if (controls.subject) {
        const subjects = data.subjects.filter((item) => (
          sameOrEmpty(classIdOf(item), afterStream.classId) &&
          (!afterStream.sectionId || !sectionIdOf(item) || sectionIdOf(item) === afterStream.sectionId) &&
          (!afterStream.streamId || !streamIdOf(item) || streamIdOf(item) === afterStream.streamId)
        ));
        setOptions(controls.subject, subjects, controls.subject.dataset.placeholder || "Select Subject", current.subjectId, subjectLabel);
      }

      if (controls.student) {
        const students = data.students.filter((item) => (
          sameOrEmpty(classIdOf(item), afterStream.classId) &&
          (!afterStream.sectionId || !sectionIdOf(item) || sectionIdOf(item) === afterStream.sectionId) &&
          (!afterStream.streamId || !streamIdOf(item) || streamIdOf(item) === afterStream.streamId)
        ));
        setOptions(controls.student, students, controls.student.dataset.placeholder || "Select Student", current.studentId, studentLabel);
      }

      const selectedClass = data.classes.find((item) => idOf(item) === selected().classId);
      if (selectedClass) {
        if (controls.academicYear && !controls.academicYear.value && selectedClass.academicYear) {
          controls.academicYear.value = selectedClass.academicYear;
        }
        if (controls.term && (!controls.term.value || controls.term.value === "1") && selectedClass.term) {
          controls.term.value = String(selectedClass.term);
        }
      }
    }

    Object.values(controls).forEach((control) => {
      if (!control || !["SELECT", "INPUT"].includes(control.tagName)) return;
      control.addEventListener("change", refresh);
    });

    scope.academicSelectorRefresh = refresh;
    refresh();
  }

  function refresh(root) {
    const parent = root && root.querySelectorAll ? root : document;
    parent.querySelectorAll(SELECTOR).forEach((scope) => {
      initScope(scope);
      if (scope.academicSelectorRefresh) scope.academicSelectorRefresh();
    });
  }

  window.AcademicSelector = { refresh };

  document.addEventListener("DOMContentLoaded", function () {
    refresh(document);
  });
})();
