/* ════════════════════════════════════════════
   SCHEDULE WIDGET  ·  app.js
   ════════════════════════════════════════════ */

// ══════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════
const BLACKBOARD_URL = 'https://mapua.blackboard.com/';
const MSTEAMS_URL = 'https://teams.microsoft.com/v2/';
const STORAGE_COURSES = 'sw_courses';
const STORAGE_SETTINGS = 'sw_settings';
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ══════════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════════
let courses = [];
let settings = { ntfyTopic: '' };
let editingId = null;
let detailCourseId = null;
let selectedColor = '#8b5cf6';
let isPinned = false;
let notifiedToday = new Set(); // track which courses we already auto-notified
let calDate = new Date();
let calSelectedDate = new Date();

// ══════════════════════════════════════════════════════════════
// DOM REFS
// ══════════════════════════════════════════════════════════════
const $courseList = document.getElementById('course-list');
const $emptyState = document.getElementById('empty-state');
const $todayStatus = document.getElementById('today-status-text');
const $clockTime = document.getElementById('clock-time');
const $clockDate = document.getElementById('clock-date');
const $clockDay = document.getElementById('clock-day');
const $dragRegion = document.getElementById('drag-region');
const $toast = document.getElementById('toast');

const $tabSchedule = document.getElementById('tab-schedule');
const $tabCalendar = document.getElementById('tab-calendar');
const $tabTasks = document.getElementById('tab-tasks');
const $viewSchedule = document.getElementById('view-schedule');
const $viewCalendar = document.getElementById('view-calendar');
const $viewTasks = document.getElementById('view-tasks');

let api = null;

window.onload = function () {
  if (typeof qt !== 'undefined') {
    // Desktop PyQt Environment
    new QWebChannel(qt.webChannelTransport, function (channel) {
      api = channel.objects.api;
      initUI();
      bootstrap();
    });
  } else {
    // Mobile APK / Web Environment
    initUI();
    bootstrapMobile();
  }
};

function initUI() {
  // title bar buttons (only work if API exists)
  const btnBb = document.getElementById('btn-blackboard');
  if (btnBb) btnBb.addEventListener('click', () => api ? api.openUrl(BLACKBOARD_URL) : window.open(BLACKBOARD_URL, '_blank'));

  const btnTms = document.getElementById('btn-teams');
  if (btnTms) btnTms.addEventListener('click', () => api ? api.openUrl(MSTEAMS_URL) : window.open(MSTEAMS_URL, '_blank'));

  const btnClose = document.getElementById('btn-close');
  if (btnClose) btnClose.addEventListener('click', () => { if (api) api.exitApp(); });

  const btnMin = document.getElementById('btn-min');
  if (btnMin) btnMin.addEventListener('click', () => { if (api) api.minimizeApp(); });

  const btnAdd = document.getElementById('btn-add');
  if (btnAdd) btnAdd.addEventListener('click', () => openFormModal(null));

  const $btnPin = document.getElementById('btn-pin');
  if ($btnPin) $btnPin.addEventListener('click', () => {
    isPinned = !isPinned;
    if (api) api.setAlwaysOnTop(isPinned);
    $btnPin.classList.toggle('active', isPinned);
    $btnPin.title = isPinned ? 'Unpin (always on top)' : 'Pin (always on top)';
  });

  document.getElementById('btn-settings').addEventListener('click', openSettingsModal);

  $tabSchedule.addEventListener('click', () => switchTab('schedule'));
  $tabCalendar.addEventListener('click', () => switchTab('calendar'));
  $tabTasks.addEventListener('click', () => switchTab('tasks'));

  document.getElementById('tasks-filter').addEventListener('change', renderAllTasks);
  document.getElementById('tasks-sort').addEventListener('change', renderAllTasks);

  document.getElementById('cal-prev').addEventListener('click', () => {
    calDate.setMonth(calDate.getMonth() - 1);
    renderCalendar();
  });

  document.getElementById('cal-next').addEventListener('click', () => {
    calDate.setMonth(calDate.getMonth() + 1);
    renderCalendar();
  });
}

function switchTab(tab) {
  $tabSchedule.classList.toggle('active', tab === 'schedule');
  $tabCalendar.classList.toggle('active', tab === 'calendar');
  $tabTasks.classList.toggle('active', tab === 'tasks');

  $viewSchedule.style.display = tab === 'schedule' ? 'flex' : 'none';
  $viewCalendar.style.display = tab === 'calendar' ? 'flex' : 'none';
  $viewTasks.style.display = tab === 'tasks' ? 'flex' : 'none';

  if (tab === 'calendar') renderCalendar();
  if (tab === 'tasks') renderAllTasks();
}

function bootstrap() {
  api.loadData(function (res) {
    try { courses = res ? JSON.parse(res) : []; } catch (e) { }
    api.loadSettings(function (s) {
      try { settings = s ? JSON.parse(s) : {}; } catch (e) { }
      startClock();
      renderCourses();
    });
  });
}

function bootstrapMobile() {
  // Try to load preloaded data if script was injected
  if (window.MOBILE_PRELOAD_COURSES) {
    try { courses = JSON.parse(window.MOBILE_PRELOAD_COURSES); } catch (e) { }
  } else {
    try { courses = JSON.parse(localStorage.getItem(STORAGE_COURSES) || '[]'); } catch (e) { }
  }

  if (window.MOBILE_PRELOAD_SETTINGS) {
    try { settings = JSON.parse(window.MOBILE_PRELOAD_SETTINGS); } catch (e) { }
  } else {
    try { settings = JSON.parse(localStorage.getItem(STORAGE_SETTINGS) || '{}'); } catch (e) { }
  }

  // Pre-sync local storage so subsequent saves persist
  localStorage.setItem(STORAGE_COURSES, JSON.stringify(courses));
  localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(settings));

  // Hide the title dragging region on mobile/APK since it's not a desktop app window
  const dragReg = document.getElementById('drag-region');
  if (dragReg) {
    // Optional: Hide pin/min/close
    document.getElementById('btn-pin').style.display = 'none';
    document.getElementById('btn-min').style.display = 'none';
    document.getElementById('btn-close').style.display = 'none';
  }

  startClock();
  renderCourses();
}

// ══════════════════════════════════════════════════════════════
// DRAG  (manual, frameless window)
// ══════════════════════════════════════════════════════════════
let isDragging = false, dragStartX = 0, dragStartY = 0, winX = 0, winY = 0;

$dragRegion.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || e.target.closest('.ctrl-btn') || !api) return;
  isDragging = true;
  dragStartX = e.screenX;
  dragStartY = e.screenY;
  if (api) {
    api.getWinPos(function (pos) {
      winX = pos[0]; winY = pos[1];
    });
  }
});

document.addEventListener('mousemove', (e) => {
  if (!isDragging || !api) return;
  api.moveWin(winX + (e.screenX - dragStartX), winY + (e.screenY - dragStartY));
});

document.addEventListener('mouseup', () => { isDragging = false; });

// ══════════════════════════════════════════════════════════════
// CLOCK + PERIODIC CHECKS
// ══════════════════════════════════════════════════════════════
function startClock() {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  let lastMin = -1;

  const tick = () => {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    $clockTime.textContent = `${h}:${m}`;
    $clockDate.textContent = `${MONTHS[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
    $clockDay.textContent = DAYS_FULL[now.getDay()];

    if (now.getMinutes() !== lastMin) {
      lastMin = now.getMinutes();
      updateAllStatuses();
      checkClassStartNotifications(now);
    }
  };

  tick();
  setInterval(tick, 1000);
}

// ══════════════════════════════════════════════════════════════
// DATA
// ══════════════════════════════════════════════════════════════
function saveCourses() {
  if (api) {
    api.saveCourses(JSON.stringify(courses));
  } else {
    localStorage.setItem(STORAGE_COURSES, JSON.stringify(courses));
  }
}

function saveSettings() {
  if (api) {
    api.saveSettings(JSON.stringify(settings));
  } else {
    localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(settings));
  }
}

function getCourseById(id) {
  return courses.find(c => c.id === id);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ══════════════════════════════════════════════════════════════
// STATUS LOGIC
// ══════════════════════════════════════════════════════════════
function getStatus(course) {
  const now = new Date();
  const dayName = DAY_LABELS[now.getDay()];

  if (!course.days || !course.days.length) {
    return { type: 'noday', label: 'No days set' };
  }

  const hasDay = course.days.some(d => (typeof d === 'string' ? d : d.day) === dayName);
  if (!hasDay) {
    return { type: 'noday', label: formatDays(course.days) };
  }

  const daySchedule = course.days.find(d => (typeof d === 'string' ? d : d.day) === dayName);
  const startTime = (typeof daySchedule === 'object' && daySchedule.start) ? daySchedule.start : course.startTime;
  const endTime = (typeof daySchedule === 'object' && daySchedule.end) ? daySchedule.end : course.endTime;

  const nowMins = now.getHours() * 60 + now.getMinutes();
  const startMins = timeToMins(startTime);
  const endMins = timeToMins(endTime);

  if (nowMins >= startMins && nowMins < endMins) return { type: 'active', label: 'In Session' };
  if (nowMins < startMins) return { type: 'upcoming', label: 'Upcoming' };
  return { type: 'done', label: 'Done' };
}

function timeToMins(t) {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function formatDays(days) {
  if (!days?.length) return 'No days set';
  const order = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return days.map(d => typeof d === 'string' ? d : d.day).sort((a, b) => order.indexOf(a) - order.indexOf(b)).join(' · ');
}

function formatTime(t) {
  if (!t) return '--';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function getNextOccurrence(course) {
  const now = new Date();
  if (!course.days || !course.days.length) return Infinity;

  const currentDay = now.getDay();
  const currentMins = now.getHours() * 60 + now.getMinutes();

  let bestNextTs = Infinity;

  course.days.forEach(d => {
    const dayStr = typeof d === 'string' ? d : d.day;
    const startStr = typeof d === 'object' && d.start ? d.start : (course.startTime || '23:59');
    const endStr = typeof d === 'object' && d.end ? d.end : (course.endTime || '23:59');

    const targetDayIndex = DAY_LABELS.indexOf(dayStr);
    if (targetDayIndex === -1) return;

    let daysToAdd = targetDayIndex - currentDay;
    const startMins = timeToMins(startStr);
    const endMins = timeToMins(endStr);

    if (daysToAdd < 0) {
      daysToAdd += 7;
    } else if (daysToAdd === 0) {
      if (currentMins >= startMins && currentMins < endMins) {
        bestNextTs = Math.min(bestNextTs, now.getTime() - 10000);
        return;
      } else if (currentMins >= endMins) {
        daysToAdd += 7;
      }
    }

    const checkDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysToAdd);
    const [h, m] = startStr.split(':').map(Number);
    checkDate.setHours(h, m, 0, 0);

    bestNextTs = Math.min(bestNextTs, checkDate.getTime());
  });

  return bestNextTs;
}

function getTodayStartTime(course) {
  if (!course.days?.length) return course.startTime || '23:59';
  const todayName = DAY_LABELS[new Date().getDay()];
  const daySchedule = course.days.find(d => (typeof d === 'string' ? d === todayName : d.day === todayName));
  if (daySchedule) {
    return (typeof daySchedule === 'object' && daySchedule.start) ? daySchedule.start : (course.startTime || '23:59');
  }
  const firstDay = course.days[0];
  return (typeof firstDay === 'object' && firstDay.start) ? firstDay.start : (course.startTime || '23:59');
}

function formatTimeRange(course) {
  if (!course.days || !course.days.length) return `${formatTime(course.startTime)} – ${formatTime(course.endTime)}`;

  const firstDay = course.days[0];
  const s1 = typeof firstDay === 'object' ? firstDay.start : course.startTime;
  const e1 = typeof firstDay === 'object' ? firstDay.end : course.endTime;

  const allSame = course.days.every(d => {
    const s = typeof d === 'object' ? d.start : course.startTime;
    const e = typeof d === 'object' ? d.end : course.endTime;
    return s === s1 && e === e1;
  });

  if (allSame) {
    return `${formatTime(s1)} – ${formatTime(e1)}`;
  } else {
    const nowDay = DAY_LABELS[new Date().getDay()];
    const todaySched = course.days.find(d => (typeof d === 'string' ? d === nowDay : d.day === nowDay));
    if (todaySched) {
      const s = typeof todaySched === 'object' ? todaySched.start : course.startTime;
      const e = typeof todaySched === 'object' ? todaySched.end : course.endTime;
      return `Today: ${formatTime(s)} – ${formatTime(e)}`;
    } else {
      return 'Mixed Times (tap to view)';
    }
  }
}

function formatCourseMetaDetail(course) {
  if (!course.days || !course.days.length) {
    return `${formatTime(course.startTime)} – ${formatTime(course.endTime)} · No days set`;
  }
  const order = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const allSame = course.days.every(d => {
    const s = typeof d === 'object' ? d.start : course.startTime;
    const e = typeof d === 'object' ? d.end : course.endTime;
    const f = course.days[0];
    const sf = typeof f === 'object' ? f.start : course.startTime;
    const ef = typeof f === 'object' ? f.end : course.endTime;
    return s === sf && e === ef;
  });

  if (allSame) {
    const f = course.days[0];
    const sf = typeof f === 'object' ? f.start : course.startTime;
    const ef = typeof f === 'object' ? f.end : course.endTime;
    return `${formatTime(sf)} – ${formatTime(ef)} · ${formatDays(course.days)}`;
  } else {
    const daysStr = course.days.slice().sort((a, b) => {
      const dA = typeof a === 'string' ? a : a.day;
      const dB = typeof b === 'string' ? b : b.day;
      return order.indexOf(dA) - order.indexOf(dB);
    }).map(d => {
      const day = typeof d === 'string' ? d : d.day;
      const start = typeof d === 'object' ? d.start : course.startTime;
      const end = typeof d === 'object' ? d.end : course.endTime;
      return `${day} (${formatTime(start)}–${formatTime(end)})`;
    }).join('<br>');
    return `<div style="line-height:1.4; margin-top:4px;">${daysStr}</div>`;
  }
}

// ══════════════════════════════════════════════════════════════
// AUTO NOTIFY ON CLASS START
// ══════════════════════════════════════════════════════════════
function checkClassStartNotifications(now) {
  if (!settings.ntfyTopic) return;

  const dayName = DAY_LABELS[now.getDay()];
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const todayKey = `${now.toDateString()}`;

  courses.forEach(course => {
    const daySchedule = course.days?.find(d => (typeof d === 'string' ? d : d.day) === dayName);
    if (!daySchedule) return;
    const startTime = (typeof daySchedule === 'object' && daySchedule.start) ? daySchedule.start : course.startTime;
    const startMins = timeToMins(startTime);
    const notifyKey = `${course.id}_${todayKey}`;

    // Notify within 1 minute of class start, only once per day
    if (Math.abs(nowMins - startMins) <= 1 && !notifiedToday.has(notifyKey)) {
      notifiedToday.add(notifyKey);
      const pending = (course.todos || []).filter(t => !t.done);
      const body = pending.length > 0
        ? `${pending.length} pending task(s):\n${pending.map(t => `• ${t.text}`).join('\n')}`
        : 'No pending tasks. You\'re all good!';
      sendPhoneNotif(`🟢 ${course.name} is starting!`, body);
    }
  });
}

// ══════════════════════════════════════════════════════════════
// NTFY.SH NOTIFICATION
// ══════════════════════════════════════════════════════════════
async function sendPhoneNotif(title, body) {
  if (!settings.ntfyTopic?.trim()) {
    showToast('⚙️ Set your ntfy channel in Settings first');
    return;
  }

  if (typeof api !== 'undefined' && api && api.sendNtfy) {
    const topic = settings.ntfyTopic.trim();
    api.sendNtfy(topic, title, body, (res) => {
      if (res === "SUCCESS") showToast('📱 Notification sent to your phone!');
      else showToast('❌ Backend Error: ' + res);
    });
    return;
  }

  try {
    await fetch(`https://ntfy.sh/${settings.ntfyTopic.trim()}`, {
      method: 'POST',
      headers: {
        'Title': title,
        'Content-Type': 'text/plain; charset=utf-8',
        'Priority': 'default',
        'Tags': 'school,calendar',
      },
      body: body,
    });
    showToast('📱 Notification sent to your phone!');
  } catch (err) {
    showToast('❌ Error: ' + (err.message || String(err)));
  }
}

// ══════════════════════════════════════════════════════════════
// RENDER COURSE LIST
// ══════════════════════════════════════════════════════════════
function renderCourses() {
  $courseList.innerHTML = '';

  if (courses.length === 0) {
    $emptyState.style.display = 'flex';
    $todayStatus.textContent = 'No classes scheduled.';
    return;
  }
  $emptyState.style.display = 'none';

  const sorted = [...courses].sort((a, b) => {
    return getNextOccurrence(a) - getNextOccurrence(b);
  });
  sorted.forEach(c => $courseList.appendChild(buildCard(c)));
  updateTodayStatus();

  if ($viewCalendar.style.display === 'flex') renderCalendar();
  if ($viewTasks.style.display === 'flex') renderAllTasks();
}

function buildCard(course) {
  const status = getStatus(course);
  const card = document.createElement('div');
  card.className = 'course-card';
  card.dataset.id = course.id;
  card.style.setProperty('--card-color', course.color || '#8b5cf6');

  if (status.type === 'active') card.classList.add('is-active');
  if (status.type === 'done') card.classList.add('is-done');

  const badgeCls = { active: 'badge-active', upcoming: 'badge-upcoming', done: 'badge-done', noday: 'badge-noday' }[status.type];

  const pendingTodos = (course.todos || []).filter(t => !t.done);
  const todoChipHtml = `
    <div class="card-todo-chip ${pendingTodos.length ? 'has-todos' : ''}">
      ${pendingTodos.length ? '📌' : '✓'} ${pendingTodos.length} task${pendingTodos.length !== 1 ? 's' : ''} pending
    </div>`;

  card.innerHTML = `
    <div class="card-body">
      <div class="card-top">
        <span class="card-name">${esc(course.name)}</span>
        ${course.code ? `<span class="card-code">${esc(course.code)}</span>` : ''}
      </div>
      <div class="card-time">${formatTimeRange(course)}</div>
      ${todoChipHtml}
      <span class="status-badge ${badgeCls}">
        <span class="status-dot"></span>
        ${status.type === 'noday' ? esc(status.label) : status.label}
      </span>
    </div>
    <button class="card-edit-btn" data-id="${course.id}" title="Edit course">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
    </button>
  `;

  card.querySelector('.card-body').addEventListener('click', () => openDetailModal(course.id));
  card.querySelector('.card-edit-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    openFormModal(course);
  });

  return card;
}

function updateAllStatuses() {
  document.querySelectorAll('.course-card').forEach(card => {
    const course = getCourseById(card.dataset.id);
    if (!course) return;
    const status = getStatus(course);
    card.classList.toggle('is-active', status.type === 'active');
    card.classList.toggle('is-done', status.type === 'done');
    const badge = card.querySelector('.status-badge');
    if (badge) {
      const cls = { active: 'badge-active', upcoming: 'badge-upcoming', done: 'badge-done', noday: 'badge-noday' }[status.type];
      badge.className = `status-badge ${cls}`;
      badge.innerHTML = `<span class="status-dot"></span> ${status.type === 'noday' ? esc(status.label) : status.label}`;
    }
  });
  updateTodayStatus();
}

function updateTodayStatus() {
  const now = new Date();
  const dayName = DAY_LABELS[now.getDay()];
  const today = courses.filter(c => c.days?.some(d => (typeof d === 'string' ? d : d.day) === dayName));

  if (!today.length) { $todayStatus.textContent = `No classes today · ${dayName}`; return; }

  const active = today.find(c => getStatus(c).type === 'active');
  if (active) { $todayStatus.textContent = `🟢 ${active.name} is in session`; return; }

  const upcoming = today
    .filter(c => getStatus(c).type === 'upcoming')
    .sort((a, b) => getTodayStartTime(a).localeCompare(getTodayStartTime(b)));
  if (upcoming.length) { $todayStatus.textContent = `Next: ${upcoming[0].name} at ${formatTime(getTodayStartTime(upcoming[0]))}`; return; }

  $todayStatus.textContent = `All ${today.length} class${today.length !== 1 ? 'es' : ''} done for today ✓`;
}

// ══════════════════════════════════════════════════════════════
// DETAIL MODAL
// ══════════════════════════════════════════════════════════════
const $modalDetail = document.getElementById('modal-detail');

function openDetailModal(courseId) {
  detailCourseId = courseId;
  renderDetailModal();
  $modalDetail.style.display = 'flex';
}

function closeDetailModal() {
  $modalDetail.style.display = 'none';
  detailCourseId = null;
}

document.getElementById('modal-detail-close').addEventListener('click', closeDetailModal);
$modalDetail.addEventListener('click', (e) => { if (e.target === $modalDetail) closeDetailModal(); });

function renderDetailModal() {
  const course = getCourseById(detailCourseId);
  if (!course) return;

  const status = getStatus(course);
  const color = course.color || '#8b5cf6';

  // header
  document.getElementById('detail-accent-bar').style.background = color;
  document.getElementById('detail-course-name').textContent = course.name + (course.code ? ` · ${course.code}` : '');
  document.getElementById('detail-course-meta').innerHTML = formatCourseMetaDetail(course);

  const sb = document.getElementById('detail-status-badge');
  const cls = { active: 'badge-active', upcoming: 'badge-upcoming', done: 'badge-done', noday: 'badge-noday' }[status.type];
  sb.className = `status-badge ${cls}`;
  sb.innerHTML = `<span class="status-dot"></span> ${status.type === 'noday' ? esc(status.label) : status.label}`;

  // join buttons
  renderJoinButtons(course);

  // todos
  renderTodos(course);

  // notes
  const $notesArea = document.getElementById('notes-area');
  $notesArea.value = course.notes || '';
  updateNotesChars();
}

// ── Join buttons ──────────────────────────────────────────────
function renderJoinButtons(course) {
  const $ja = document.getElementById('detail-join-actions');
  $ja.innerHTML = '';
  const hasTeams = !!course.teamsLink?.trim();
  const hasZoom = !!course.zoomLink?.trim();

  if (!hasTeams && !hasZoom) {
    $ja.innerHTML = `<p class="no-links-msg">No meeting links set.<br>Edit this course to add one.</p>`;
    return;
  }

  if (hasTeams) {
    const btn = document.createElement('button');
    btn.className = 'join-btn join-btn-teams';
    btn.innerHTML = `
      <span class="join-btn-icon">🟣</span>
      <span class="join-btn-text">Join on Microsoft Teams<small>Open Teams meeting</small></span>`;
    btn.addEventListener('click', () => {
      if (api) api.openUrl(course.teamsLink.trim());
      else window.open(course.teamsLink.trim(), '_blank');
      closeDetailModal();
    });
    $ja.appendChild(btn);
  }

  if (hasZoom) {
    const btn = document.createElement('button');
    btn.className = 'join-btn join-btn-zoom';
    btn.innerHTML = `
      <span class="join-btn-icon">🔵</span>
      <span class="join-btn-text">Join on Zoom<small>Open Zoom meeting</small></span>`;
    btn.addEventListener('click', () => {
      if (api) api.openUrl(course.zoomLink.trim());
      else window.open(course.zoomLink.trim(), '_blank');
      closeDetailModal();
    });
    $ja.appendChild(btn);
  }
}

// ── To-Do ─────────────────────────────────────────────────────
function renderTodos(course) {
  const $list = document.getElementById('todo-list');
  $list.innerHTML = '';

  const todos = course.todos || [];
  const pending = todos.filter(t => !t.done).length;
  const badge = document.getElementById('todo-count-badge');
  badge.textContent = pending;
  badge.style.display = 'inline-block';

  if (todos.length === 0) {
    $list.innerHTML = `<p style="font-size:11px;color:var(--text-3);text-align:center;padding:8px 0;">No tasks yet. Add one below!</p>`;
    return;
  }

  // Sort: undone first, then done
  const sorted = [...todos].sort((a, b) => Number(a.done) - Number(b.done));

  sorted.forEach(todo => {
    const item = document.createElement('div');
    item.className = 'todo-item';
    item.dataset.todoId = todo.id;

    item.innerHTML = `
      <div class="todo-check ${todo.done ? 'checked' : ''}" data-id="${todo.id}">
        ${todo.done ? '✓' : ''}
      </div>
      <span class="todo-text ${todo.done ? 'done-text' : ''}">${esc(todo.text)}</span>
      <div class="todo-actions">
        <button class="todo-action-btn notify-btn" title="Send to phone" data-id="${todo.id}">🔔</button>
        <button class="todo-action-btn delete-btn" title="Delete task" data-id="${todo.id}">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
    `;

    // toggle done
    item.querySelector('.todo-check').addEventListener('click', () => toggleTodo(course.id, todo.id));

    // notify
    item.querySelector('.notify-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const t = (course.todos || []).find(x => x.id === todo.id);
      if (t) sendPhoneNotif(`📌 Reminder: ${course.name}`, t.text);
    });

    // delete
    item.querySelector('.delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTodo(course.id, todo.id);
    });

    $list.appendChild(item);
  });
}

function toggleTodo(courseId, todoId) {
  const course = getCourseById(courseId);
  if (!course) return;
  const todo = (course.todos || []).find(t => t.id === todoId);
  if (todo) {
    todo.done = !todo.done;
    saveCourses();
    renderTodos(course);
    refreshCardTodoChip(courseId);
  }
}

function deleteTodo(courseId, todoId) {
  const course = getCourseById(courseId);
  if (!course) return;
  course.todos = (course.todos || []).filter(t => t.id !== todoId);
  saveCourses();
  renderTodos(course);
  refreshCardTodoChip(courseId);
}

function refreshCardTodoChip(courseId) {
  const course = getCourseById(courseId);
  if (!course) return;
  const card = document.querySelector(`.course-card[data-id="${courseId}"]`);
  if (!card) return;
  const pending = (course.todos || []).filter(t => !t.done).length;
  const chip = card.querySelector('.card-todo-chip');
  if (chip) {
    chip.className = `card-todo-chip ${pending ? 'has-todos' : ''}`;
    chip.textContent = `${pending ? '📌' : '✓'} ${pending} task${pending !== 1 ? 's' : ''} pending`;
  }
}

// Add todo
document.getElementById('btn-todo-add').addEventListener('click', addTodo);
document.getElementById('todo-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addTodo();
});

function addTodo() {
  const $inp = document.getElementById('todo-input');
  const $dueInp = document.getElementById('todo-due-date');
  const text = $inp.value.trim();
  if (!text || !detailCourseId) return;

  const course = getCourseById(detailCourseId);
  if (!course) return;

  if (!course.todos) course.todos = [];
  course.todos.push({ 
    id: uid(), 
    text, 
    done: false, 
    dueDate: $dueInp ? $dueInp.value : '',
    createdAt: new Date().toISOString() 
  });
  saveCourses();
  $inp.value = '';
  if ($dueInp) $dueInp.value = '';
  renderTodos(course);
  refreshCardTodoChip(detailCourseId);
}

// ── Notes ─────────────────────────────────────────────────────
const $notesArea = document.getElementById('notes-area');

$notesArea.addEventListener('input', updateNotesChars);

function updateNotesChars() {
  document.getElementById('notes-chars').textContent = `${$notesArea.value.length} / 1000`;
}

document.getElementById('btn-notes-save').addEventListener('click', () => {
  if (!detailCourseId) return;
  const course = getCourseById(detailCourseId);
  if (!course) return;
  course.notes = $notesArea.value;
  saveCourses();
  showToast('📝 Note saved!');
});

// ══════════════════════════════════════════════════════════════
// FORM MODAL (Add / Edit Course)
// ══════════════════════════════════════════════════════════════
const $modalForm = document.getElementById('modal-form');
const $dayBtns = document.querySelectorAll('.day-btn');
const $colorDots = document.querySelectorAll('.color-dot');

function openFormModal(course) {
  editingId = course?.id || null;
  document.getElementById('course-form').reset();
  $dayBtns.forEach(b => b.classList.remove('selected'));
  selectedColor = '#8b5cf6';
  $colorDots.forEach(d => d.classList.toggle('active', d.dataset.color === selectedColor));

  const dayTimesMap = {};

  if (course) {
    document.getElementById('form-title').textContent = 'Edit Course';
    document.getElementById('form-id').value = course.id;
    document.getElementById('form-name').value = course.name;
    document.getElementById('form-code').value = course.code || '';
    document.getElementById('form-teams').value = course.teamsLink || '';
    document.getElementById('form-zoom').value = course.zoomLink || '';
    selectedColor = course.color || '#8b5cf6';

    (course.days || []).forEach(d => {
      const dayStr = typeof d === 'string' ? d : d.day;
      const startT = typeof d === 'object' ? d.start : course.startTime;
      const endT = typeof d === 'object' ? d.end : course.endTime;
      dayTimesMap[dayStr] = { start: startT, end: endT };
      document.querySelector(`.day-btn[data-day="${dayStr}"]`)?.classList.add('selected');
    });
    $colorDots.forEach(d => d.classList.toggle('active', d.dataset.color === selectedColor));
    document.getElementById('btn-delete-course').style.display = 'block';
  } else {
    document.getElementById('form-title').textContent = 'Add Course';
    document.getElementById('form-id').value = '';
    document.getElementById('btn-delete-course').style.display = 'none';
  }

  renderDayTimesInputs(dayTimesMap);
  $modalForm.style.display = 'flex';
  setTimeout(() => document.getElementById('form-name').focus(), 80);
}

function closeFormModal() {
  $modalForm.style.display = 'none';
  editingId = null;
}

document.getElementById('modal-form-close').addEventListener('click', closeFormModal);
document.getElementById('btn-form-cancel').addEventListener('click', closeFormModal);
$modalForm.addEventListener('click', (e) => { if (e.target === $modalForm) closeFormModal(); });

$dayBtns.forEach(btn => btn.addEventListener('click', () => {
  btn.classList.toggle('selected');
  renderDayTimesInputs();
}));

function renderDayTimesInputs(initialMap = null) {
  const container = document.getElementById('day-times-container');
  const existingValues = initialMap || {};

  if (!initialMap) {
    container.querySelectorAll('.day-time-row').forEach(row => {
      existingValues[row.dataset.day] = {
        start: row.querySelector('.time-start').value,
        end: row.querySelector('.time-end').value
      };
    });
  }

  container.innerHTML = '';
  const selectedDays = [...$dayBtns].filter(b => b.classList.contains('selected')).map(b => b.dataset.day);

  if (selectedDays.length === 0) {
    container.innerHTML = '<div style="font-size:12px;color:var(--text-3);">Select days to configure times.</div>';
    return;
  }

  let defaultStart = '';
  let defaultEnd = '';
  for (const day of selectedDays) {
    if (existingValues[day]?.start) { defaultStart = existingValues[day].start; defaultEnd = existingValues[day].end; break; }
  }

  selectedDays.forEach(day => {
    const vals = existingValues[day] || { start: defaultStart, end: defaultEnd };
    const row = document.createElement('div');
    row.className = 'day-time-row';
    row.dataset.day = day;
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    row.innerHTML = `
      <div style="flex:0 0 40px; font-weight:600; font-size:13px; color:var(--text-2);">${day}</div>
      <input type="time" class="time-start" value="${vals.start}" required style="flex:1" />
      <span style="color:var(--text-3)">–</span>
      <input type="time" class="time-end" value="${vals.end}" required style="flex:1" />
    `;
    container.appendChild(row);
  });
}
$colorDots.forEach(dot => {
  dot.addEventListener('click', () => {
    $colorDots.forEach(d => d.classList.remove('active'));
    dot.classList.add('active');
    selectedColor = dot.dataset.color;
  });
});

document.getElementById('btn-delete-course').addEventListener('click', () => {
  if (!editingId) return;
  courses = courses.filter(c => c.id !== editingId);
  saveCourses();
  renderCourses();
  closeFormModal();
  showToast('Course deleted.');
});

document.getElementById('course-form').addEventListener('submit', (e) => {
  e.preventDefault();

  const days = [];
  let minStart = '';
  let minEnd = '';

  document.querySelectorAll('.day-time-row').forEach(row => {
    const day = row.dataset.day;
    const start = row.querySelector('.time-start').value;
    const end = row.querySelector('.time-end').value;

    if (!minStart || start < minStart) minStart = start;
    if (!minEnd || end < minEnd) minEnd = end;

    days.push({ day, start, end });
  });

  const data = {
    id: editingId || uid(),
    name: document.getElementById('form-name').value.trim(),
    code: document.getElementById('form-code').value.trim(),
    days,
    startTime: minStart, // Backwards compatibility for DB sorting
    endTime: minEnd,   // Backwards compatibility

    teamsLink: document.getElementById('form-teams').value.trim(),
    zoomLink: document.getElementById('form-zoom').value.trim(),
    color: selectedColor,
    todos: editingId ? (getCourseById(editingId)?.todos || []) : [],
    notes: editingId ? (getCourseById(editingId)?.notes || '') : '',
  };

  if (!data.name || !data.startTime || !data.endTime) return;

  if (editingId) {
    const idx = courses.findIndex(c => c.id === editingId);
    if (idx !== -1) courses[idx] = data;
  } else {
    courses.push(data);
  }

  saveCourses();
  renderCourses();
  closeFormModal();
});

// ══════════════════════════════════════════════════════════════
// SETTINGS MODAL
// ══════════════════════════════════════════════════════════════
const $modalSettings = document.getElementById('modal-settings');

function openSettingsModal() {
  document.getElementById('settings-ntfy').value = settings.ntfyTopic || '';
  $modalSettings.style.display = 'flex';
}

function closeSettingsModal() {
  $modalSettings.style.display = 'none';
}

document.getElementById('modal-settings-close').addEventListener('click', closeSettingsModal);
document.getElementById('btn-settings-cancel').addEventListener('click', closeSettingsModal);
$modalSettings.addEventListener('click', (e) => { if (e.target === $modalSettings) closeSettingsModal(); });

document.getElementById('btn-settings-save').addEventListener('click', () => {
  settings.ntfyTopic = document.getElementById('settings-ntfy').value.trim();
  saveSettings();
  closeSettingsModal();
  showToast(settings.ntfyTopic ? '✅ Ntfy channel saved!' : '⚠️ No channel set — notifications disabled.');
});

document.getElementById('btn-test-ntfy').addEventListener('click', () => {
  const topic = document.getElementById('settings-ntfy').value.trim();
  if (!topic) {
    showToast('⚙️ Enter a channel name first');
    return;
  }
  const oldTopic = settings.ntfyTopic;
  settings.ntfyTopic = topic;
  sendPhoneNotif('🧪 Test Notification', 'If you see this, ntfy is working!');
  settings.ntfyTopic = oldTopic;
});

// ══════════════════════════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════════════════════════
let toastTimer = null;

function showToast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), 2800);
}

// ══════════════════════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════════════════════
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ══════════════════════════════════════════════════════════════
// CALENDAR
// ══════════════════════════════════════════════════════════════
function renderCalendar() {
  const year = calDate.getFullYear();
  const month = calDate.getMonth();
  const today = new Date();

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  document.getElementById('cal-month-year').textContent = `${MONTHS[month]} ${year}`;

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();

  const $grid = document.getElementById('cal-grid');
  $grid.innerHTML = '';

  let currentDay = 1;
  let nextMonthDay = 1;

  for (let i = 0; i < 42; i++) {
    const $cell = document.createElement('div');
    $cell.className = 'cal-date';

    let cellDate;
    if (i < firstDay) {
      $cell.innerHTML = `<span>${prevMonthDays - firstDay + i + 1}</span>`;
      $cell.classList.add('other-month');
      cellDate = new Date(year, month - 1, prevMonthDays - firstDay + i + 1);
    } else if (currentDay <= daysInMonth) {
      $cell.innerHTML = `<span>${currentDay}</span>`;
      cellDate = new Date(year, month, currentDay);

      if (cellDate.getDate() === today.getDate() && cellDate.getMonth() === today.getMonth() && cellDate.getFullYear() === today.getFullYear()) {
        $cell.classList.add('today');
      }

      if (cellDate.getDate() === calSelectedDate.getDate() && cellDate.getMonth() === calSelectedDate.getMonth() && cellDate.getFullYear() === calSelectedDate.getFullYear()) {
        $cell.classList.add('active');
      }

      const dotsCont = document.createElement('div');
      dotsCont.className = 'cal-dots';
      const dayName = DAY_LABELS[cellDate.getDay()];
      const dayCourses = courses.filter(c => c.days?.some(d => (typeof d === 'string' ? d : d.day) === dayName));
      if (dayCourses.length > 0) {
        dayCourses.slice(0, 3).forEach(c => {
          const dot = document.createElement('div');
          dot.className = 'cal-dot';
          dot.style.background = c.color || '#8b5cf6';
          dotsCont.appendChild(dot);
        });
        $cell.appendChild(dotsCont);
      }
      currentDay++;
    } else {
      $cell.innerHTML = `<span>${nextMonthDay}</span>`;
      $cell.classList.add('other-month');
      cellDate = new Date(year, month + 1, nextMonthDay);
      nextMonthDay++;
    }

    $cell.addEventListener('click', () => {
      calSelectedDate = new Date(cellDate.getTime());
      if (cellDate.getMonth() !== month) {
        calDate = new Date(cellDate.getTime());
      }
      renderCalendar();
    });

    $grid.appendChild($cell);
  }

  renderCalendarDayDetails();
}

function renderCalendarDayDetails() {
  const $dateLabel = document.getElementById('cal-selected-date');
  const $dayCourses = document.getElementById('cal-day-courses');
  const $dayTasks = document.getElementById('cal-day-tasks');
  const $tasksContainer = document.getElementById('cal-tasks-container');
  const $empty = document.getElementById('cal-empty-state');
  
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const fullDays = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  
  $dateLabel.textContent = `${fullDays[calSelectedDate.getDay()]}, ${MONTHS[calSelectedDate.getMonth()]} ${calSelectedDate.getDate()}`;
  $dayCourses.innerHTML = '';
  $dayTasks.innerHTML = '';
  
  const dayName = DAY_LABELS[calSelectedDate.getDay()];
  const sessions = [];
  courses.forEach(c => {
      const dScheds = c.days?.filter(d => (typeof d === 'string' ? d : d.day) === dayName);
      if (dScheds && dScheds.length > 0) {
          dScheds.forEach(dSched => {
              const start = (typeof dSched === 'object' && dSched.start) ? dSched.start : c.startTime;
              const end = (typeof dSched === 'object' && dSched.end) ? dSched.end : c.endTime;
              sessions.push({ course: c, start, end });
          });
      }
  });

  const dueTasks = [];
  courses.forEach(c => {
    (c.todos || []).forEach(t => {
      if (!t.dueDate) return;
      const d = new Date(t.dueDate);
      if (d.toDateString() === calSelectedDate.toDateString()) {
        dueTasks.push({...t, courseId: c.id, courseName: c.name, courseColor: c.color});
      }
    });
  });
  
  const hasAnything = sessions.length > 0 || dueTasks.length > 0;
  
  if (!hasAnything) {
    document.querySelectorAll('.cal-section-header').forEach(h => h.style.display = 'none');
    $dayCourses.style.display = 'none';
    $tasksContainer.style.display = 'none';
    $empty.style.display = 'block';
  } else {
    $empty.style.display = 'none';
    document.querySelectorAll('.cal-section-header').forEach(h => h.style.display = 'block');
    
    // Render Courses
    if (sessions.length > 0) {
      $dayCourses.style.display = 'flex';
      sessions.sort((a,b) => a.start.localeCompare(b.start));
      sessions.forEach(session => {
         const c = session.course;
         const cd = document.createElement('div');
         cd.className = 'cal-item-card';
         cd.style.cssText = 'display:flex; align-items:center; gap:10px; padding:10px 12px; background:var(--glass); border:1px solid var(--border); border-radius:var(--r-md); cursor:pointer;';
         
         const timeStr = `${formatTime(session.start)} – ${formatTime(session.end)}`;
         cd.innerHTML = `
           <div style="width:3px; height:32px; background:${c.color || '#8b5cf6'}; border-radius:3px; flex-shrink:0;"></div>
           <div style="flex:1; min-width:0;">
              <div style="font-size:13px; font-weight:700; color:var(--text-1); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(c.name)}</div>
              <div style="font-size:10px; color:var(--text-2); margin-top:2px; display:flex; align-items:center; gap:6px;">
                 ${timeStr} 
                 ${c.code ? `<span style="background:var(--border); padding:1px 4px; border-radius:3px;">${esc(c.code)}</span>` : ''}
              </div>
           </div>
         `;
         cd.onclick = () => openDetailModal(c.id);
         $dayCourses.appendChild(cd);
      });
    } else {
      $dayCourses.style.display = 'none';
      document.querySelector('.cal-section-header').style.display = 'none';
    }

    // Render Tasks
    if (dueTasks.length > 0) {
      $tasksContainer.style.display = 'block';
      dueTasks.sort((a,b) => Number(a.done) - Number(b.done));
      dueTasks.forEach(todo => {
        const td = document.createElement('div');
        td.className = 'todo-item';
        td.style.padding = '10px 12px';
        td.style.background = 'var(--glass)';
        td.style.border = '1px solid var(--border)';
        td.style.borderRadius = 'var(--r-md)';
        td.style.cursor = 'pointer';
        
        const d = new Date(todo.dueDate);
        const timeStr = d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});

        td.innerHTML = `
          <div class="todo-check ${todo.done ? 'checked' : ''}" style="margin-right: 0;">
            ${todo.done ? '✓' : ''}
          </div>
          <div style="flex:1; min-width:0; padding: 0 10px;">
            <div class="todo-text ${todo.done ? 'done-text' : ''}" style="font-size:13px; margin:0; line-height:1.2;">${esc(todo.text)}</div>
            <div style="font-size:9.5px; color:${todo.courseColor || '#8b5cf6'}; font-weight:600; margin-top:2px;">
              ${esc(todo.courseName)} <span style="color:var(--text-3); font-weight:400; margin-left:4px;">Due ${timeStr}</span>
            </div>
          </div>
        `;
        td.onclick = () => openDetailModal(todo.courseId);
        $dayTasks.appendChild(td);
      });
    } else {
      $tasksContainer.style.display = 'none';
    }
  }
}

// ══════════════════════════════════════════════════════════════
// TASKS VIEW
// ══════════════════════════════════════════════════════════════
function renderAllTasks() {
  const filter = document.getElementById('tasks-filter').value;
  const sort = document.getElementById('tasks-sort').value;
  const $list = document.getElementById('all-tasks-list');
  const $empty = document.getElementById('tasks-empty-state');

  $list.innerHTML = '';

  let allTasks = [];
  courses.forEach(c => {
    if (c.todos) {
      c.todos.forEach(t => {
        allTasks.push({ ...t, courseId: c.id, courseName: c.name, courseColor: c.color });
      });
    }
  });

  if (filter === 'pending') allTasks = allTasks.filter(t => !t.done);
  if (filter === 'done') allTasks = allTasks.filter(t => t.done);

  if (allTasks.length === 0) {
    $list.style.display = 'none';
    $empty.style.display = 'flex';
    return;
  }

  $list.style.display = 'flex';
  $empty.style.display = 'none';

  if (sort === 'course') {
    allTasks.sort((a, b) => {
      const cCmp = a.courseName.localeCompare(b.courseName);
      if (cCmp !== 0) return cCmp;
      return Number(a.done) - Number(b.done);
    });
  } else if (sort === 'newest') {
    allTasks.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  } else if (sort === 'oldest') {
    allTasks.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  }

  allTasks.forEach(todo => {
    const item = document.createElement('div');
    item.className = 'todo-item';
    item.style.flexShrink = '0';
    item.innerHTML = `
      <div class="todo-check ${todo.done ? 'checked' : ''}" data-course="${todo.courseId}" data-id="${todo.id}">
        ${todo.done ? '✓' : ''}
      </div>
      <div style="flex:1; min-width:0;">
          <div class="todo-text ${todo.done ? 'done-text' : ''}" style="margin-bottom:2px;">${esc(todo.text)}</div>
          <div style="font-size:9.5px; font-weight:600; color:${todo.courseColor || '#8b5cf6'}">${esc(todo.courseName)}</div>
      </div>
      <div class="todo-actions">
        <button class="todo-action-btn notify-btn" title="Send to phone" data-course="${todo.courseId}" data-id="${todo.id}">🔔</button>
        <button class="todo-action-btn delete-btn" title="Delete task" data-course="${todo.courseId}" data-id="${todo.id}">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
    `;

    item.querySelector('.todo-check').addEventListener('click', () => {
      toggleTodo(todo.courseId, todo.id);
      if ($viewTasks.style.display === 'flex') renderAllTasks();
    });

    item.querySelector('.notify-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const course = getCourseById(todo.courseId);
      if (course) sendPhoneNotif(`📌 Reminder: ${course.name}`, todo.text);
    });

    item.querySelector('.delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTodo(todo.courseId, todo.id);
      if ($viewTasks.style.display === 'flex') renderAllTasks();
    });

    $list.appendChild(item);
  });
}

