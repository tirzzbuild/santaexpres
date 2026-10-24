import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ArrowLeft, Bell, CheckCheck, CircleHelp, ImagePlus, LogOut,
  MessageCircle, Moon, MoreHorizontal, Plus, Search, Send, Settings,
  ShieldCheck, Sun, X, Zap
} from 'lucide-react'
import { isSupabaseConfigured, supabase, type Conversation, type Message, type Profile } from './lib/supabase'

type AuthMode = 'login' | 'signup'
type ChatRow = { conversation: Conversation; other: Profile; lastMessage?: Message }

const initials = (name?: string | null) => (name || '?').trim().slice(0, 2).toUpperCase()
const formatTime = (value?: string) => value ? new Date(value).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : ''
const formatDay = (value?: string) => value ? new Date(value).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : ''

export default function App() {
  const [sessionUser, setSessionUser] = useState<{ id: string; email?: string } | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [authUsername, setAuthUsername] = useState('')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authMessage, setAuthMessage] = useState('')
  const [dark, setDark] = useState(true)
  const [search, setSearch] = useState('')
  const [people, setPeople] = useState<Profile[]>([])
  const [chats, setChats] = useState<ChatRow[]>([])
  const [activeChat, setActiveChat] = useState<ChatRow | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [loadingChats, setLoadingChats] = useState(false)
  const [sending, setSending] = useState(false)
  const [mobileList, setMobileList] = useState(true)
  const [showProfile, setShowProfile] = useState(false)
  const [editDisplay, setEditDisplay] = useState('')
  const [editBio, setEditBio] = useState('')
  const [uploading, setUploading] = useState(false)
  const [notice, setNotice] = useState('')
  const [onlineIds, setOnlineIds] = useState<string[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) setSessionUser({ id: data.session.user.id, email: data.session.user.email })
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionUser(session?.user ? { id: session.user.id, email: session.user.email } : null)
      if (!session?.user) { setProfile(null); setActiveChat(null); setChats([]); setMessages([]) }
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!supabase || !sessionUser) return
    let cancelled = false
    const load = async () => {
      const { data, error } = await supabase!.from('profiles').select('*').eq('id', sessionUser.id).maybeSingle()
      if (cancelled) return
      if (error) { setNotice(`Gagal memuat profil: ${error.message}`); return }
      if (data) {
        setProfile(data as Profile); setEditDisplay(data.display_name || ''); setEditBio(data.bio || '')
      }
    }
    void load()
    return () => { cancelled = true }
  }, [sessionUser])

  const loadChats = useCallback(async () => {
    if (!supabase || !sessionUser) return
    setLoadingChats(true)
    const { data: memberships, error } = await supabase
      .from('conversation_members').select('conversation_id').eq('user_id', sessionUser.id)
    if (error) { setNotice(`Gagal memuat chat: ${error.message}`); setLoadingChats(false); return }
    const ids = (memberships || []).map(row => row.conversation_id as string)
    if (!ids.length) { setChats([]); setLoadingChats(false); return }
    const { data: conversations, error: convError } = await supabase.from('conversations').select('*').in('id', ids).order('updated_at', { ascending: false })
    if (convError) { setNotice(convError.message); setLoadingChats(false); return }
    const rows: ChatRow[] = []
    for (const conv of (conversations || []) as Conversation[]) {
      const { data: members } = await supabase.from('conversation_members').select('user_id').eq('conversation_id', conv.id)
      const otherId = (members || []).map(m => m.user_id as string).find(id => id !== sessionUser.id)
      if (!otherId) continue
      const { data: other } = await supabase.from('profiles').select('*').eq('id', otherId).maybeSingle()
      if (!other) continue
      const { data: last } = await supabase.from('messages').select('*').eq('conversation_id', conv.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
      rows.push({ conversation: conv, other: other as Profile, lastMessage: last as Message | undefined })
    }
    setChats(rows)
    setLoadingChats(false)
  }, [sessionUser])

  useEffect(() => { void loadChats() }, [loadChats])

  useEffect(() => {
    if (!supabase || !activeChat || !sessionUser) { setMessages([]); return }
    const conversationId = activeChat.conversation.id
    let alive = true
    const load = async () => {
      const { data, error } = await supabase!.from('messages').select('*').eq('conversation_id', conversationId).order('created_at', { ascending: true }).limit(100)
      if (alive && error) setNotice(`Gagal memuat pesan: ${error.message}`)
      if (alive && data) setMessages(data as Message[])
    }
    void load()
    const channel = supabase.channel(`messages-${conversationId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, payload => {
        const msg = payload.new as Message
        setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg])
        void loadChats()
      })
      .subscribe()
    return () => { alive = false; void supabase!.removeChannel(channel) }
  }, [activeChat?.conversation.id, sessionUser, loadChats])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const filteredChats = useMemo(() => chats.filter(c =>
    (c.other.display_name || c.other.username).toLowerCase().includes(search.toLowerCase()) ||
    c.other.username.toLowerCase().includes(search.toLowerCase())
  ), [chats, search])

  const handleAuth = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase) return
    setAuthBusy(true); setAuthMessage('')
    const username = authUsername.trim().toLowerCase()
    if (authMode === 'signup' && !/^[a-z0-9_]{3,24}$/.test(username)) {
      setAuthMessage('Username harus 3–24 karakter: huruf kecil, angka, atau garis bawah.')
      setAuthBusy(false); return
    }
    if (authMode === 'signup') {
      if (!authEmail.trim()) { setAuthMessage('Masukkan email yang aktif.'); setAuthBusy(false); return }
      const { data, error } = await supabase.auth.signUp({
        email: authEmail.trim(), password: authPassword,
        options: { data: { username, display_name: displayName.trim() || username } }
      })
      if (error) setAuthMessage(error.message)
      else if (data.session) setAuthMessage('Akun dibuat. Memuat profil…')
      else setAuthMessage('Pendaftaran berhasil. Periksa email untuk verifikasi, lalu login.')
    } else {
      if (!authEmail.trim()) { setAuthMessage('Untuk MVP ini, login menggunakan email dan password. Login username akan ditambahkan melalui Edge Function yang dikonfigurasi server-side.'); setAuthBusy(false); return }
      const { error } = await supabase.auth.signInWithPassword({ email: authEmail.trim(), password: authPassword })
      if (error) setAuthMessage(error.message)
    }
    setAuthBusy(false)
  }

  const searchPeople = async (value: string) => {
    setSearch(value)
    if (!supabase || !sessionUser || value.trim().length < 2) { setPeople([]); return }
    const term = value.trim().replace(/[,%()]/g, '')
    const { data, error } = await supabase.from('profiles').select('id,username,display_name,avatar_url,bio').ilike('username', `${term}%`).neq('id', sessionUser.id).limit(12)
    if (error) setNotice(`Pencarian gagal: ${error.message}`)
    else setPeople((data || []) as Profile[])
  }

  const startChat = async (person: Profile) => {
    if (!supabase || !sessionUser) return
    const existing = chats.find(c => c.other.id === person.id)
    if (existing) { setActiveChat(existing); setMobileList(false); setPeople([]); setSearch(''); return }
    const { data: found, error: findError } = await supabase.rpc('find_or_create_direct_conversation', { other_user_id: person.id })
    if (findError || !found) { setNotice(`Tidak dapat memulai chat: ${findError?.message || 'coba lagi'}`); return }
    const conversation = found as Conversation
    const row: ChatRow = { conversation, other: person }
    setChats(prev => [row, ...prev.filter(c => c.conversation.id !== conversation.id)])
    setActiveChat(row); setMobileList(false); setPeople([]); setSearch('')
  }

  const sendMessage = async (event?: FormEvent) => {
    event?.preventDefault()
    const body = draft.trim()
    if (!supabase || !sessionUser || !activeChat || !body || sending) return
    setSending(true)
    const { error } = await supabase.from('messages').insert({ conversation_id: activeChat.conversation.id, sender_id: sessionUser.id, body })
    if (error) setNotice(`Pesan gagal dikirim: ${error.message}`)
    else setDraft('')
    setSending(false)
    void loadChats()
  }

  const uploadImage = async (file?: File) => {
    if (!supabase || !sessionUser || !activeChat || !file) return
    if (!file.type.startsWith('image/')) { setNotice('MVP saat ini hanya menerima gambar.'); return }
    if (file.size > 5 * 1024 * 1024) { setNotice('Ukuran gambar maksimal 5 MB.'); return }
    setUploading(true)
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const path = `${activeChat.conversation.id}/${sessionUser.id}/${crypto.randomUUID()}.${ext}`
    const { error: uploadError } = await supabase.storage.from('chat-media').upload(path, file, { contentType: file.type, upsert: false })
    if (uploadError) { setNotice(`Upload gagal: ${uploadError.message}`); setUploading(false); return }
    const { error: messageError } = await supabase.from('messages').insert({
      conversation_id: activeChat.conversation.id, sender_id: sessionUser.id,
      body: `[[image:${path}]]`
    })
    if (messageError) setNotice(`Gambar terunggah, tetapi pesan gagal: ${messageError.message}`)
    setUploading(false); void loadChats()
  }

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase || !sessionUser || !profile) return
    const { error } = await supabase.from('profiles').update({ display_name: editDisplay.trim() || profile.username, bio: editBio.trim() }).eq('id', sessionUser.id)
    if (error) setNotice(`Profil gagal disimpan: ${error.message}`)
    else { setProfile({ ...profile, display_name: editDisplay.trim() || profile.username, bio: editBio.trim() }); setShowProfile(false); setNotice('Profil tersimpan.') }
  }

  const signOut = async () => { await supabase?.auth.signOut(); setShowProfile(false) }

  if (!isSupabaseConfigured || !supabase) return <SetupScreen />
  if (!sessionUser || !profile) return (
    <main className="auth-screen">
      <div className="auth-glow glow-one" /><div className="auth-glow glow-two" />
      <div className="auth-layout">
        <section className="auth-brand">
          <div className="brand-mark large"><MessageCircle size={29} strokeWidth={2.5}/><span className="brand-spark">✦</span></div>
          <div className="eyebrow"><span className="live-dot"/> YOUR SPACE. YOUR PEOPLE.</div>
          <h1>Obrolan yang terasa <span>lebih dekat.</span></h1>
          <p>Ruang pribadi untuk cerita, ide, dan momen yang ingin kamu bagikan.</p>
          <div className="auth-pills"><span><ShieldCheck size={15}/> Private by design</span><span><Zap size={15}/> Realtime chat</span></div>
        </section>
        <section className="auth-card">
          <div className="auth-card-top"><div className="brand-lockup"><div className="brand-mark"><MessageCircle size={21}/></div><span>SANTA<span className="purple-text">CHAT</span></span></div><span className="secure-tag"><span className="live-dot"/> SECURE SPACE</span></div>
          <div className="auth-heading"><h2>{authMode === 'login' ? 'Selamat datang kembali' : 'Buat akunmu'}</h2><p>{authMode === 'login' ? 'Masuk dan lanjutkan percakapanmu.' : 'Bergabung dan mulai terhubung.'}</p></div>
          <form onSubmit={handleAuth} className="auth-form">
            {authMode === 'signup' && <label>Nama tampilan<input value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="Nama yang ditampilkan" maxLength={50}/></label>}
            {authMode === 'signup' && <label>Username<input value={authUsername} onChange={e=>setAuthUsername(e.target.value)} placeholder="misal: santafan" autoComplete="username" required minLength={3} maxLength={24}/><small>3–24 karakter, huruf kecil, angka, garis bawah.</small></label>}
            <label>Email<input value={authEmail} onChange={e=>setAuthEmail(e.target.value)} placeholder="kamu@email.com" type="email" autoComplete="email" required/></label>
            <label>Password<input value={authPassword} onChange={e=>setAuthPassword(e.target.value)} placeholder="Minimal 8 karakter" type="password" autoComplete={authMode==='login'?'current-password':'new-password'} required minLength={8}/></label>
            {authMessage && <div className="form-message" role="status">{authMessage}</div>}
            <button className="primary-button full-button" disabled={authBusy}>{authBusy ? <span className="spinner"/> : <>{authMode==='login'?'Masuk ke SANTACHAT':'Buat akun'} <span>→</span></>}</button>
          </form>
          <p className="auth-switch">{authMode==='login'?'Belum punya akun?':'Sudah punya akun?'} <button onClick={()=>{setAuthMode(authMode==='login'?'signup':'login');setAuthMessage('')}}>{authMode==='login'?'Daftar sekarang':'Masuk'}</button></p>
          <div className="auth-footer"><ShieldCheck size={14}/> Password dikelola aman oleh Supabase Auth.</div>
        </section>
      </div>
      <div className="auth-bottom"><span>© 2026 SANTACHAT</span><span>BUILT FOR REAL CONNECTIONS</span></div>
    </main>
  )

  return (
    <main className={dark ? 'app-shell dark' : 'app-shell light'}>
      <aside className={`sidebar ${mobileList ? 'mobile-visible' : 'mobile-hidden'}`}>
        <div className="sidebar-header">
          <div className="brand-lockup"><div className="brand-mark"><MessageCircle size={21}/></div><span>SANTA<span className="purple-text">CHAT</span></span></div>
          <button className="icon-button" title="Menu" onClick={()=>setShowProfile(true)}><MoreHorizontal size={20}/></button>
        </div>
        <div className="sidebar-welcome"><div><div className="eyebrow">YOUR MESSAGES</div><h1>Obrolan<span>.</span></h1></div><button className="new-chat-button" title="Cari pengguna" onClick={()=>document.getElementById('search-people')?.focus()}><Plus size={18}/></button></div>
        <div className="search-box"><Search size={17}/><input id="search-people" placeholder="Cari username atau chat..." value={search} onChange={e=>void searchPeople(e.target.value)}/>{search && <button onClick={()=>{setSearch('');setPeople([])}}><X size={14}/></button>}</div>
        {people.length>0 && <div className="people-results"><div className="section-label">PENGGUNA DITEMUKAN</div>{people.map(p=><button key={p.id} className="person-result" onClick={()=>void startChat(p)}><Avatar profile={p}/><span><b>{p.display_name||p.username}</b><small>@{p.username}</small></span><Plus size={16}/></button>)}</div>}
        <div className="chat-list-heading"><span>SEMUA PESAN</span><span className="count-pill">{chats.length}</span></div>
        <div className="chat-list">
          {loadingChats && <div className="empty-list">Memuat percakapan…</div>}
          {!loadingChats && filteredChats.length===0 && <div className="empty-list"><div className="empty-icon"><MessageCircle size={20}/></div><b>Belum ada obrolan</b><span>Cari username untuk memulai percakapan baru.</span></div>}
          {filteredChats.map(row=><button key={row.conversation.id} className={`chat-row ${activeChat?.conversation.id===row.conversation.id?'selected':''}`} onClick={()=>{setActiveChat(row);setMobileList(false)}}><Avatar profile={row.other} online={onlineIds.includes(row.other.id)}/><span className="chat-row-content"><span className="chat-row-top"><b>{row.other.display_name||row.other.username}</b><time>{formatTime(row.lastMessage?.created_at||row.conversation.updated_at)}</time></span><span className="chat-preview">{row.lastMessage?.body.startsWith('[[image:')?'📷 Foto':row.lastMessage?.body||`@${row.other.username}`}</span></span></button>)}
        </div>
        <div className="sidebar-bottom"><div className="user-mini"><Avatar profile={profile}/><span><b>{profile.display_name||profile.username}</b><small>@{profile.username}</small></span><button className="icon-button" onClick={()=>setShowProfile(true)} title="Pengaturan profil"><Settings size={17}/></button></div><div className="sidebar-foot"><span><span className="live-dot"/> TERHUBUNG</span><span>v0.1 MVP</span></div></div>
      </aside>
      <section className={`conversation-area ${mobileList?'mobile-hidden':''}`}>
        {activeChat ? <>
          <header className="conversation-header">
            <button className="icon-button back-button" onClick={()=>setMobileList(true)} title="Kembali"><ArrowLeft size={20}/></button>
            <Avatar profile={activeChat.other} online={onlineIds.includes(activeChat.other.id)}/>
            <div className="conversation-person"><b>{activeChat.other.display_name||activeChat.other.username}</b><span>{onlineIds.includes(activeChat.other.id)?'Online':`@${activeChat.other.username}`}</span></div>
            <div className="header-actions"><span className="encrypted-label"><ShieldCheck size={14}/> PRIVATE CHAT</span><button className="icon-button" onClick={()=>setShowProfile(true)} title="Pengaturan"><MoreHorizontal size={20}/></button></div>
          </header>
          <div className="message-background">
            <div className="conversation-date"><span>AWAL PERCAKAPAN</span></div>
            {messages.length===0 && <div className="conversation-empty"><div className="empty-icon big"><MessageCircle size={25}/></div><h3>Mulai dari sini.</h3><p>Kirim pesan pertama ke {activeChat.other.display_name||activeChat.other.username}.</p></div>}
            {messages.map(message=><MessageBubble key={message.id} message={message} mine={message.sender_id===sessionUser.id} onImageClick={async path=>{if(!supabase)return;const {data,error}=await supabase.storage.from('chat-media').createSignedUrl(path,60);if(error)setNotice(error.message);else if(data?.signedUrl)window.open(data.signedUrl,'_blank','noopener,noreferrer')}}/> )}
            <div ref={bottomRef}/>
          </div>
          <form className="composer" onSubmit={sendMessage}>
            <input ref={fileInput} type="file" accept="image/*" hidden onChange={e=>{void uploadImage(e.target.files?.[0]);e.currentTarget.value=''}}/>
            <button type="button" className="icon-button attachment-button" title="Kirim foto (maks. 5 MB)" disabled={uploading} onClick={()=>fileInput.current?.click()}>{uploading?<span className="spinner small"/>:<ImagePlus size={20}/>}</button>
            <div className="composer-input-wrap"><input value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Tulis pesan..." aria-label="Tulis pesan"/><span className="composer-hint">ENTER UNTUK KIRIM</span></div>
            <button className="send-button" type="submit" disabled={!draft.trim()||sending} aria-label="Kirim pesan">{sending?<span className="spinner small"/>:<Send size={18}/>}</button>
          </form>
          <div className="composer-note"><ShieldCheck size={12}/> Jaga percakapan tetap nyaman dan aman.</div>
        </> : <div className="welcome-panel"><div className="welcome-orbit orbit-a"/><div className="welcome-orbit orbit-b"/><div className="welcome-logo"><MessageCircle size={35}/><span className="welcome-spark">✦</span></div><div className="eyebrow">YOUR SPACE IS READY</div><h2>Semua cerita,<br/><span>dimulai dari sini.</span></h2><p>Pilih obrolan di samping atau cari username untuk terhubung dengan seseorang.</p><button className="primary-button" onClick={()=>{setMobileList(true);document.getElementById('search-people')?.focus()}}><Plus size={17}/> Mulai obrolan</button><div className="welcome-bottom"><span><ShieldCheck size={14}/> PRIVASI DIUTAMAKAN</span><span><Zap size={14}/> REALTIME</span></div></div>}
      </section>
      {showProfile && <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setShowProfile(false)}}><section className="profile-modal"><div className="modal-header"><div><div className="eyebrow">ACCOUNT SETTINGS</div><h2>Profil & pengaturan</h2></div><button className="icon-button" onClick={()=>setShowProfile(false)}><X size={20}/></button></div><div className="profile-card"><Avatar profile={profile} large/><div><b>{profile.display_name||profile.username}</b><span>@{profile.username}</span><small>{sessionUser.email}</small></div></div><form className="profile-form" onSubmit={saveProfile}><label>Nama tampilan<input value={editDisplay} onChange={e=>setEditDisplay(e.target.value)} maxLength={50}/></label><label>Bio<input value={editBio} onChange={e=>setEditBio(e.target.value)} maxLength={160} placeholder="Ceritakan sedikit tentang dirimu"/></label><button className="primary-button full-button">Simpan profil</button></form><div className="settings-row"><span><span className="settings-icon"><Moon size={17}/></span><span><b>Tampilan</b><small>Mode gelap / terang</small></span></span><button className="toggle" onClick={()=>setDark(!dark)} aria-label="Ganti tema">{dark?<Moon size={14}/>:<Sun size={14}/>}<span>{dark?'Gelap':'Terang'}</span></button></div><div className="settings-row"><span><span className="settings-icon"><Bell size={17}/></span><span><b>Notifikasi</b><small>Push notification belum dikonfigurasi</small></span></span></div><div className="settings-row"><span><span className="settings-icon"><CircleHelp size={17}/></span><span><b>Versi aplikasi</b><small>SANTACHAT Web MVP 0.1.0</small></span></div><button className="logout-button" onClick={()=>void signOut()}><LogOut size={17}/> Keluar dari akun</button><p className="modal-foot"><ShieldCheck size={13}/> Jangan bagikan kata sandi kepada siapa pun.</p></section></div>}
      {notice && <div className="toast" role="status">{notice}<button onClick={()=>setNotice('')}><X size={15}/></button></div>}
    </main>
  )
}

function Avatar({ profile, online = false, large = false }: { profile: Profile; online?: boolean; large?: boolean }) {
  return <span className={`avatar ${large?'avatar-large':''}`}>{profile.avatar_url ? <img src={profile.avatar_url} alt=""/> : initials(profile.display_name||profile.username)}{online && <i className="online-dot"/>}</span>
}

function MessageBubble({ message, mine, onImageClick }: { message: Message; mine: boolean; onImageClick: (path:string)=>void }) {
  const imagePath = message.body.match(/^\[\[image:(.+)\]\]$/)?.[1]
  return <div className={`message-line ${mine?'mine':'theirs'}`}><div className={`message-bubble ${mine?'mine-bubble':'theirs-bubble'}`}>{imagePath ? <button className="image-message" onClick={()=>onImageClick(imagePath)}><ImagePlus size={20}/><span>Buka foto</span></button> : <p>{message.body}</p>}<span className="message-meta">{formatTime(message.created_at)} {mine && <CheckCheck size={13}/>}</span></div></div>
}

function SetupScreen() {
  return <main className="setup-screen"><div className="setup-card"><div className="brand-lockup"><div className="brand-mark"><MessageCircle size={22}/></div><span>SANTA<span className="purple-text">CHAT</span></span></div><div className="setup-icon"><Settings size={26}/></div><div className="eyebrow">ONE-TIME SETUP</div><h1>Hubungkan ruang chat kamu.</h1><p>Frontend sudah disiapkan. Tambahkan kredensial frontend Supabase di environment variables agar aplikasi dapat terhubung ke backend.</p><div className="setup-steps"><div><span>01</span><p>Buat proyek di Supabase dan jalankan SQL migration dari folder <code>supabase/migrations</code>.</p></div><div><span>02</span><p>Salin <code>.env.example</code> menjadi <code>.env</code>, lalu isi URL dan publishable/anon key Supabase.</p></div><div><span>03</span><p>Jalankan <code>npm install</code> dan <code>npm run dev</code>.</p></div></div><div className="setup-warning"><ShieldCheck size={17}/><span>Jangan pernah menaruh service_role key di frontend atau mengunggah file .env ke GitHub.</span></div></div></main>
}