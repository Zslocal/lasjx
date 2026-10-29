const state = {
  user: null,
  posts: [],
  page: 1,
  limit: 10,
  total: 0,
  filter: 'all',
  loading: false,
  files: [],
  editingPost: null,
  lightboxItems: [],
  lightboxIndex: 0,
}

const el = (id) => document.getElementById(id)

const timelineEl = el('timeline')
const emptyEl = el('emptyState')
const loadMoreBtn = el('loadMoreBtn')
const composeForm = el('createForm')
const composeToggle = el('composeToggle')
const fileInput = el('fileInput')
const dropzone = el('dropzone')
const fileList = el('fileList')
const createMsg = el('createMsg')
const createSubmit = el('createSubmit')
const template = el('postTemplate')

const editModal = el('editModal')
const editForm = el('editForm')
const editMsg = el('editMsg')
const settingsModal = el('settingsModal')
const settingsForm = el('settingsForm')
const settingsMsg = el('settingsMsg')

const lightbox = el('lightbox')
const lightboxBody = el('lightboxBody')

function toast(message) {
  const node = document.createElement('div')
  node.className = 'toast'
  node.textContent = message
  document.body.appendChild(node)
  requestAnimationFrame(() => node.classList.add('show'))
  setTimeout(() => {
    node.classList.remove('show')
    setTimeout(() => node.remove(), 300)
  }, 2200)
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  })
}

function fileUrl(name) {
  return `/uploads/${encodeURIComponent(name)}`
}

function extLabel(name, mime) {
  const fromName = (name || '').split('.').pop()
  if (fromName && fromName.length <= 5 && fromName !== name) return fromName.toUpperCase()
  const fromMime = (mime || '').split('/').pop()
  return (fromMime || 'FILE').slice(0, 5).toUpperCase()
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...options,
  })
  if (res.status === 401) {
    location.replace('/login.html')
    throw new Error('未登录')
  }
  let data = null
  const type = res.headers.get('content-type') || ''
  if (type.includes('application/json')) {
    data = await res.json().catch(() => null)
  }
  if (!res.ok) {
    const message = (data && data.error) || `请求失败（${res.status}）`
    throw new Error(message)
  }
  return data
}

function isAdmin() {
  return state.user && state.user.role === 'admin'
}

async function loadMe() {
  const data = await api('/api/me')
  if (!data || !data.user) {
    location.replace('/login.html')
    return false
  }
  state.user = data.user
  const chip = el('userChip')
  chip.hidden = false
  chip.innerHTML = `<span class="name">${escapeHtml(state.user.username)}</span><span class="role">${
    state.user.role === 'admin' ? '管理员' : '成员'
  }</span>`
  el('logoutBtn').hidden = false
  el('openSettingsBtn').hidden = false
  return true
}

function renderFileList() {
  fileList.innerHTML = ''
  state.files.forEach((file, index) => {
    const li = document.createElement('li')
    li.innerHTML = `<span class="name">${escapeHtml(file.name)}</span><span class="size">${formatSize(
      file.size,
    )}</span><button class="rm" type="button" aria-label="移除">&times;</button>`
    li.querySelector('.rm').addEventListener('click', () => {
      state.files.splice(index, 1)
      renderFileList()
    })
    fileList.appendChild(li)
  })
}

function addFiles(list) {
  const max = 10
  for (const file of Array.from(list)) {
    if (state.files.length >= max) {
      createMsg.textContent = '一次最多上传 10 个文件'
      break
    }
    const exists = state.files.some((f) => f.name === file.name && f.size === file.size)
    if (!exists) state.files.push(file)
  }
  renderFileList()
}

function postMatchesFilter(post) {
  if (state.filter === 'all') return true
  return (post.media || []).some((m) => m.kind === state.filter)
}

function mediaNode(media, post) {
  if (media.kind === 'image') {
    const wrap = document.createElement('div')
    wrap.className = 'media-item'
    const img = document.createElement('img')
    img.src = fileUrl(media.filename)
    img.alt = media.original_name
    img.loading = 'lazy'
    const open = document.createElement('button')
    open.className = 'open'
    open.type = 'button'
    open.setAttribute('aria-label', `查看 ${media.original_name}`)
    open.addEventListener('click', () => openLightbox(post, media))
    wrap.append(img, open)
    appendMediaRemove(wrap, media)
    return wrap
  }

  if (media.kind === 'video') {
    const wrap = document.createElement('div')
    wrap.className = 'media-item'
    const video = document.createElement('video')
    video.src = fileUrl(media.filename)
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    const play = document.createElement('span')
    play.className = 'media-play'
    play.textContent = '\u25B6'
    const open = document.createElement('button')
    open.className = 'open play'
    open.type = 'button'
    open.setAttribute('aria-label', `播放 ${media.original_name}`)
    open.addEventListener('click', () => openLightbox(post, media))
    wrap.append(video, play, open)
    appendMediaRemove(wrap, media)
    return wrap
  }

  const wrap = document.createElement('div')
  wrap.className = 'media-item'
  const link = document.createElement('a')
  link.className = 'media-file'
  link.href = fileUrl(media.filename)
  link.target = '_blank'
  link.rel = 'noopener'
  link.download = media.original_name
  link.innerHTML = `<span class="file-badge">${escapeHtml(
    extLabel(media.original_name, media.mime),
  )}</span><span class="file-name">${escapeHtml(media.original_name)}</span><span class="size">${formatSize(
    media.size,
  )}</span>`
  wrap.append(link)
  appendMediaRemove(wrap, media)
  return wrap
}

function appendMediaRemove(wrap, media) {
  if (!isAdmin()) return
  const btn = document.createElement('button')
  btn.className = 'media-remove'
  btn.type = 'button'
  btn.title = '删除这个文件'
  btn.textContent = '\u00d7'
  btn.addEventListener('click', async (event) => {
    event.stopPropagation()
    if (!confirm(`确定删除文件「${media.original_name}」吗？`)) return
    try {
      await api(`/api/media/${media.id}`, { method: 'DELETE' })
      await refreshPosts()
    } catch (error) {
      alert(error.message)
    }
  })
  wrap.appendChild(btn)
}

function dateParts(value) {
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return { day: '--', rest: value }
  const day = String(date.getDate()).padStart(2, '0')
  const rest = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}`
  return { day, rest }
}

function renderPost(post) {
  const node = template.content.firstElementChild.cloneNode(true)
  const { day, rest } = dateParts(post.event_date)
  node.dataset.id = post.id
  node.querySelector('.date-day').textContent = day
  node.querySelector('.date-rest').textContent = rest
  node.querySelector('.post-title').textContent = post.title

  const contentEl = node.querySelector('.post-content')
  if (post.content) {
    contentEl.textContent = post.content
  } else {
    contentEl.remove()
  }

  const mediaWrap = node.querySelector('.post-media')
  for (const media of post.media || []) {
    mediaWrap.appendChild(mediaNode(media, post))
  }

  node.querySelector('.post-author').textContent = post.author_name
    ? `记录者 ${post.author_name}`
    : '我们的回忆'
  const count = (post.media || []).length
  node.querySelector('.post-count').textContent = count ? `${count} 个文件` : ''

  const actions = node.querySelector('.post-actions')
  if (!isAdmin()) {
    actions.remove()
  } else {
    actions.querySelector('[data-action="edit"]').addEventListener('click', () => openEdit(post))
    actions.querySelector('[data-action="delete"]').addEventListener('click', () => deletePost(post))
  }

  timelineEl.appendChild(node)
}

function renderTimeline() {
  timelineEl.innerHTML = ''
  const visible = state.posts.filter(postMatchesFilter)
  visible.forEach(renderPost)
  const showEmpty = state.posts.length === 0
  emptyEl.hidden = !showEmpty
  loadMoreBtn.hidden = state.posts.length >= state.total
}

function updateStats(data) {
  el('statPosts').textContent = data.posts
  el('statMedia').textContent = data.media
  el('statDays').textContent = data.days
}

async function fetchPage(page) {
  const [data, stats] = await Promise.all([
    api(`/api/posts?page=${page}&limit=${state.limit}`),
    api('/api/stats'),
  ])
  if (page === 1) {
    state.posts = data.posts
  } else {
    state.posts = state.posts.concat(data.posts)
  }
  state.page = page
  state.total = data.total
  renderTimeline()
  updateStats(stats)
}

async function refreshPosts() {
  await fetchPage(1)
}

async function loadMore() {
  if (state.loading || state.posts.length >= state.total) return
  state.loading = true
  loadMoreBtn.disabled = true
  try {
    await fetchPage(state.page + 1)
  } catch (error) {
    alert(error.message)
  } finally {
    state.loading = false
    loadMoreBtn.disabled = false
  }
}

function openEdit(post) {
  state.editingPost = post
  editMsg.textContent = ''
  editForm.title.value = post.title
  editForm.eventDate.value = post.event_date
  editForm.content.value = post.content || ''
  editModal.showModal()
}

async function deletePost(post) {
  if (!confirm(`确定删除「${post.title}」吗？其中的文件也会一并删除。`)) return
  try {
    await api(`/api/posts/${post.id}`, { method: 'DELETE' })
    await refreshPosts()
  } catch (error) {
    alert(error.message)
  }
}

function collectLightboxItems(post) {
  return (post.media || []).filter((m) => m.kind === 'image' || m.kind === 'video')
}

function openLightbox(post, media) {
  const items = collectLightboxItems(post)
  const index = items.findIndex((m) => m.id === media.id)
  state.lightboxItems = items
  state.lightboxIndex = index >= 0 ? index : 0
  showLightbox()
}

function showLightbox() {
  const media = state.lightboxItems[state.lightboxIndex]
  if (!media) return
  lightboxBody.innerHTML = ''
  let node
  if (media.kind === 'video') {
    node = document.createElement('video')
    node.src = fileUrl(media.filename)
    node.controls = true
    node.autoplay = true
    node.playsInline = true
  } else {
    node = document.createElement('img')
    node.src = fileUrl(media.filename)
    node.alt = media.original_name
  }
  const caption = document.createElement('figcaption')
  caption.textContent = media.original_name
  lightboxBody.append(node, caption)
  lightbox.hidden = false
  document.body.style.overflow = 'hidden'
  const many = state.lightboxItems.length > 1
  el('lightboxPrev').style.visibility = many ? 'visible' : 'hidden'
  el('lightboxNext').style.visibility = many ? 'visible' : 'hidden'
}

function closeLightbox() {
  lightbox.hidden = true
  lightboxBody.innerHTML = ''
  document.body.style.overflow = ''
}

function stepLightbox(delta) {
  const len = state.lightboxItems.length
  if (len < 2) return
  state.lightboxIndex = (state.lightboxIndex + delta + len) % len
  showLightbox()
}

function bindEvents() {
  el('logoutBtn').addEventListener('click', async () => {
    try {
      await api('/api/logout', { method: 'POST' })
    } catch {
      /* ignore */
    }
    location.replace('/login.html')
  })

  el('openSettingsBtn').addEventListener('click', () => {
    settingsForm.reset()
    settingsMsg.textContent = ''
    settingsModal.showModal()
  })

  el('settingsCancel').addEventListener('click', () => settingsModal.close())
  el('editCancel').addEventListener('click', () => editModal.close())

  composeToggle.addEventListener('click', () => {
    const open = !composeForm.hidden
    composeForm.hidden = open
    if (!open) composeForm.title.focus()
  })

  fileInput.addEventListener('change', () => {
    addFiles(fileInput.files)
    fileInput.value = ''
  })

  dropzone.addEventListener('click', (event) => {
    if (event.target.closest('.file-list')) return
    fileInput.click()
  })

  ;['dragenter', 'dragover'].forEach((type) => {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault()
      dropzone.classList.add('dragover')
    })
  })
  ;['dragleave', 'drop'].forEach((type) => {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault()
      dropzone.classList.remove('dragover')
    })
  })
  dropzone.addEventListener('drop', (event) => {
    if (event.dataTransfer && event.dataTransfer.files.length) {
      addFiles(event.dataTransfer.files)
    }
  })

  composeForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    createMsg.textContent = ''
    createMsg.classList.remove('ok')

    const title = composeForm.title.value.trim()
    const eventDate = composeForm.eventDate.value
    const content = composeForm.content.value.trim()

    if (!title) {
      createMsg.textContent = '请填写标题'
      return
    }
    if (!eventDate) {
      createMsg.textContent = '请选择日期'
      return
    }
    if (state.files.length === 0) {
      createMsg.textContent = '请至少选择一个文件'
      return
    }

    const formData = new FormData()
    formData.append('title', title)
    formData.append('eventDate', eventDate)
    formData.append('content', content)
    for (const file of state.files) formData.append('files', file, file.name)

    createSubmit.disabled = true
    createSubmit.textContent = '正在上传…'
    try {
      await api('/api/posts', { method: 'POST', body: formData })
      state.files = []
      renderFileList()
      composeForm.reset()
      composeForm.hidden = true
      toast('回忆已保存')
      await refreshPosts()
    } catch (error) {
      createMsg.textContent = error.message
    } finally {
      createSubmit.disabled = false
      createSubmit.textContent = '保存这段回忆'
    }
  })

  loadMoreBtn.addEventListener('click', loadMore)

  el('filterBar').addEventListener('click', (event) => {
    const btn = event.target.closest('.seg')
    if (!btn) return
    state.filter = btn.dataset.filter
    for (const seg of el('filterBar').querySelectorAll('.seg')) {
      seg.classList.toggle('is-active', seg === btn)
    }
    renderTimeline()
  })

  editForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!state.editingPost) return
    editMsg.textContent = ''
    const title = editForm.title.value.trim()
    const eventDate = editForm.eventDate.value
    const content = editForm.content.value.trim()
    if (!title || !eventDate) {
      editMsg.textContent = '请填写标题和日期'
      return
    }
    try {
      await api(`/api/posts/${state.editingPost.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, eventDate, content }),
      })
      editModal.close()
      await refreshPosts()
    } catch (error) {
      editMsg.textContent = error.message
    }
  })

  settingsForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    settingsMsg.textContent = ''
    const currentPassword = settingsForm.currentPassword.value
    const newPassword = settingsForm.newPassword.value
    if (newPassword.length < 6) {
      settingsMsg.textContent = '新密码至少 6 位'
      return
    }
    try {
      await api('/api/me/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      settingsModal.close()
      alert('密码已更新，请使用新密码下次登录')
    } catch (error) {
      settingsMsg.textContent = error.message
    }
  })

  el('lightboxClose').addEventListener('click', closeLightbox)
  el('lightboxPrev').addEventListener('click', () => stepLightbox(-1))
  el('lightboxNext').addEventListener('click', () => stepLightbox(1))
  lightbox.addEventListener('click', (event) => {
    if (event.target === lightbox) closeLightbox()
  })

  document.addEventListener('keydown', (event) => {
    if (lightbox.hidden) return
    if (event.key === 'Escape') closeLightbox()
    if (event.key === 'ArrowLeft') stepLightbox(-1)
    if (event.key === 'ArrowRight') stepLightbox(1)
  })
}

async function init() {
  const ok = await loadMe()
  if (!ok) return
  const today = new Date()
  composeForm.eventDate.value = today.toISOString().slice(0, 10)
  bindEvents()
  try {
    await fetchPage(1)
  } catch (error) {
    console.error(error)
  }
}

init()
