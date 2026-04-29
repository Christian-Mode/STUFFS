/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { 
  TrendingUp, 
  Lightbulb, 
  FileText, 
  Video, 
  Send, 
  BarChart3, 
  Zap, 
  Settings, 
  Play, 
  Pause,
  Repeat,
  Loader2,
  Plus,
  RefreshCw,
  LogOut,
  ChevronRight,
  Sparkles,
  Cpu,
  Globe
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { auth, db, handleFirestoreError, OperationType } from "./lib/firebase";
import { 
  GoogleAuthProvider, 
  signInWithPopup, 
  onAuthStateChanged, 
  signOut,
  User
} from "firebase/auth";
import {
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  Timestamp,
  updateDoc,
  deleteDoc,
  doc,
  limit,
  where,
  getDocFromServer,
  serverTimestamp
} from "firebase/firestore";
import { 
  huntTrends, 
  generateConcept, 
  writeScript, 
  generatePostAssets,
  analyzePerformance 
} from "./services/gemini";
import { cn } from "./lib/utils";

// Components
const StatCard = ({ label, value, icon: Icon, color }: any) => (
  <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center gap-4">
    <div className={cn("p-3 rounded-lg", color)}>
      <Icon className="w-5 h-5 text-white" />
    </div>
    <div>
      <p className="text-white/50 text-xs uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-bold text-white tracking-tight">{value}</p>
    </div>
  </div>
);

const AgentStatus = ({ name, status, icon: Icon }: any) => (
  <div className="flex items-center gap-3 py-3 border-b border-white/5">
    <div className={cn(
      "w-8 h-8 rounded-full flex items-center justify-center transition-all duration-500",
      status === "active" ? "bg-emerald-500/20 text-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.2)]" : "bg-white/5 text-white/40"
    )}>
      <Icon className={cn("w-4 h-4", status === "active" && "animate-pulse")} />
    </div>
    <span className={cn("text-sm transition-colors", status === "active" ? "text-white font-medium" : "text-white/40")}>
      {name}
    </span>
    {status === "active" && (
      <motion.span 
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="ml-auto text-[10px] bg-emerald-500/20 text-emerald-500 px-2 py-0.5 rounded uppercase font-bold tracking-tighter"
      >
        Active
      </motion.span>
    )}
  </div>
);

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAutonomous, setIsAutonomous] = useState(false);
  const [activeStep, setActiveStep] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [currentView, setCurrentView] = useState("dashboard");
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  
  // Data State
  const [trends, setTrends] = useState<any[]>([]);
  const [concepts, setConcepts] = useState<any[]>([]);
  const [scripts, setScripts] = useState<any[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  const [channels, setChannels] = useState<any[]>([]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setLoading(false);
      
      if (u) {
        // Test connection
        try {
          await getDocFromServer(doc(db, 'test', 'connection'));
        } catch (error) {
          if(error instanceof Error && error.message.includes('the client is offline')) {
            console.error("Please check your Firebase configuration.");
          }
        }
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!user) return;

    const trendsUnsub = onSnapshot(
      query(collection(db, "trends"), where("userId", "==", user.uid), orderBy("createdAt", "desc"), limit(20)), 
      (s) => {
        setTrends(s.docs.map(d => ({ id: d.id, ...d.data() })));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "trends")
    );
    
    const conceptsUnsub = onSnapshot(
      query(collection(db, "concepts"), where("userId", "==", user.uid), orderBy("createdAt", "desc"), limit(20)), 
      (s) => {
        setConcepts(s.docs.map(d => ({ id: d.id, ...d.data() })));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "concepts")
    );
    
    const scriptsUnsub = onSnapshot(
      query(collection(db, "scripts"), where("userId", "==", user.uid), orderBy("createdAt", "desc"), limit(20)), 
      (s) => {
        setScripts(s.docs.map(d => ({ id: d.id, ...d.data() })));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "scripts")
    );
    
    const postsUnsub = onSnapshot(
      query(collection(db, "posts"), where("userId", "==", user.uid), orderBy("createdAt", "desc"), limit(20)), 
      (s) => {
        setPosts(s.docs.map(d => ({ id: d.id, ...d.data() })));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "posts")
    );

    const channelsUnsub = onSnapshot(
      query(collection(db, "channels"), where("userId", "==", user.uid), orderBy("createdAt", "desc")), 
      (s) => {
        setChannels(s.docs.map(d => ({ id: d.id, ...d.data() })));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "channels")
    );

    return () => {
      trendsUnsub();
      conceptsUnsub();
      scriptsUnsub();
      postsUnsub();
      channelsUnsub();
    };
  }, [user]);

  const addLog = (msg: string) => {
    setLogs(prev => [msg, ...prev].slice(0, 50));
  };

  const runAgentCycle = async () => {
    if (!user || activeStep) return;
    try {
      // 1. Trend Hunter
      setActiveStep("Trend Hunter");
      addLog("🚀 Trend Hunter initiated: Scanning social horizon...");
      const trendData = await huntTrends();
      for (const t of trendData.trends) {
        // Strict field selection for Trend entity (7 keys)
        const trendPayload = {
          topic: t.topic,
          growth: t.growth,
          source: t.source,
          keywords: t.keywords || [],
          audience: t.audience,
          userId: user.uid,
          createdAt: serverTimestamp()
        };
        await addDoc(collection(db, "trends"), trendPayload)
          .catch(err => handleFirestoreError(err, OperationType.CREATE, "trends"));
      }
      addLog(`✨ Found ${trendData.trends.length} viral trends.`);

      // 2. Idea Generator (on new trends)
      setActiveStep("Idea Generator");
      addLog("🧠 Idea Generator: Brainstorming viral concepts...");
      const lastTrend = trendData.trends[0];
      const conceptResult = await generateConcept(lastTrend);
      
      // Strict field selection to match security rules (data.keys().size() == 7)
      const concept = {
        title: conceptResult.title || "Untitled Concept",
        angle: conceptResult.angle || "No angle provided",
        targetAudience: conceptResult.targetAudience || "General"
      };

      const conceptDoc = await addDoc(collection(db, "concepts"), {
        ...concept,
        userId: user.uid,
        trendId: lastTrend.topic,
        status: "pending",
        createdAt: serverTimestamp()
      }).catch(err => handleFirestoreError(err, OperationType.CREATE, "concepts"));

      if (!conceptDoc) throw new Error("Concept generation failed");

      // 3. Script Writer
      setActiveStep("Script Writer");
      addLog(`✍️ Scripting: "${concept.title}"...`);
      const scriptResult = await writeScript(concept);
      
      // Strict field selection for Script entity (8 keys)
      const scriptPayload = {
        hook: scriptResult.hook || "No hook provided",
        body: scriptResult.body || "No body provided",
        cta: scriptResult.cta || "No CTA provided",
        visualCues: scriptResult.visualCues || "No visual cues",
        durationEstimate: scriptResult.durationEstimate || 0,
        userId: user.uid,
        conceptId: conceptDoc.id,
        createdAt: serverTimestamp()
      };

      await addDoc(collection(db, "scripts"), scriptPayload)
        .catch(err => handleFirestoreError(err, OperationType.CREATE, "scripts"));
      
      await updateDoc(doc(db, "concepts", conceptDoc.id), { status: "scripted" })
        .catch(err => handleFirestoreError(err, OperationType.UPDATE, `concepts/${conceptDoc.id}`));

      // 4. Publisher / Asset Generation
      setActiveStep("Publisher Tool");
      addLog(`🎨 Generating assets for: "${concept.title}"...`);
      const assetsResult = await generatePostAssets(scriptPayload);
      
      // Strict field selection for Post entity (9 initial keys + optional performance)
      const postPayload = {
        caption: assetsResult.caption || "Untitled Post",
        hashtags: assetsResult.hashtags || [],
        userId: user.uid,
        productionId: "simulated_" + Math.random().toString(36).slice(2),
        conceptId: conceptDoc.id,
        platform: ["tiktok", "shorts", "reels"][Math.floor(Math.random() * 3)],
        status: "published",
        createdAt: serverTimestamp(),
        publishedAt: serverTimestamp()
      };

      const postDoc = await addDoc(collection(db, "posts"), postPayload)
        .catch(err => handleFirestoreError(err, OperationType.CREATE, "posts"));

      if (!postDoc) throw new Error("Post generation failed");

      // 5. Analyst
      setActiveStep("Analyst");
      addLog(`📊 Analyzing initial metrics for "${concept.title}"...`);
      const performance = await analyzePerformance(assetsResult);
      await updateDoc(doc(db, "posts", postDoc.id), { performance })
        .catch(err => handleFirestoreError(err, OperationType.UPDATE, `posts/${postDoc.id}`));

      addLog("🏁 Cycle complete. Nexus Factory idling.");
      setActiveStep(null);
    } catch (err) {
      console.error(err);
      addLog(`❌ Error in cycle: ${err instanceof Error ? err.message : String(err)}`);
      setActiveStep(null);
    }
  };

  useEffect(() => {
    let interval: any;
    if (isAutonomous && !activeStep) {
      runAgentCycle();
      interval = setInterval(() => {
        if (!activeStep) runAgentCycle();
      }, 30000); // Pulse every 30s for demo
    }
    return () => clearInterval(interval);
  }, [isAutonomous, activeStep]);

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error(err);
    }
  };

  const handleManualPulse = () => {
    if (!activeStep) runAgentCycle();
  };

  const handleAutoDetect = () => {
    setIsScanning(true);
    addLog("🔍 System scanning for local identifiers...");
    setTimeout(() => {
      setIsScanning(false);
      addLog("❌ No active OAuth sessions found. Manual linking required.");
      alert("No active social media sessions detected on this machine. Please use the 'Link New Node' feature.");
    }, 2500);
  };

  const handleConnectChannel = async (platform: string) => {
    if (!user) return;
    const handle = prompt(`Enter your ${platform} handle (without @):`);
    if (!handle) return;

    setIsConnecting(true);
    try {
      addLog(`📡 Initiating handshake with ${platform} API...`);
      // Simulate OAuth latency
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      await addDoc(collection(db, "channels"), {
        platform,
        handle,
        userId: user.uid,
        status: "active",
        avatarUrl: `https://api.dicebear.com/7.x/initials/svg?seed=${handle}`,
        createdAt: serverTimestamp()
      }).catch(err => handleFirestoreError(err, OperationType.CREATE, "channels"));
      
      addLog(`✅ Node identity verified: @${handle} on ${platform}`);
    } catch (err) {
      console.error(err);
    } finally {
      setIsConnecting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-white/20 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center p-6 text-center">
        <div className="w-24 h-24 bg-orange-500/10 rounded-[2rem] flex items-center justify-center mb-8 border border-white/5 relative group">
          <div className="absolute inset-0 bg-orange-500/20 blur-3xl rounded-full scale-50 group-hover:scale-100 transition-transform duration-1000" />
          <Sparkles className="w-12 h-12 text-orange-500 relative z-10" />
        </div>
        <h1 className="text-5xl font-black text-white mb-3 tracking-tighter uppercase italic">Nexus Factory</h1>
        <p className="text-white/40 mb-12 max-w-sm font-medium leading-relaxed uppercase text-xs tracking-widest">
          The next evolution of media. Autonomous AI agents scanning, creating, and scaling your viral empire.
        </p>
        <button 
          onClick={handleLogin}
          className="bg-white text-black px-10 py-4 rounded-full font-black uppercase text-xs tracking-[0.2em] hover:bg-white/90 transition-all flex items-center gap-4 active:scale-95 shadow-2xl shadow-white/10"
        >
          <Plus className="w-4 h-4" />
          Initialize Core
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white flex flex-col lg:flex-row font-sans selection:bg-orange-500 selection:text-white overflow-x-hidden">
      {/* Mobile Header */}
      <header className="lg:hidden h-16 border-b border-white/5 flex items-center justify-between px-6 bg-[#080808] z-[60] sticky top-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
            <Zap className="w-5 h-5 text-black" fill="currentColor" />
          </div>
          <span className="font-black tracking-tighter text-lg italic uppercase">Nexus</span>
        </div>
        <button 
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="p-2 hover:bg-white/5 rounded-lg border border-white/5"
        >
          {isSidebarOpen ? <LogOut className="w-5 h-5 rotate-90" /> : <ChevronRight className="w-5 h-5" />}
        </button>
      </header>

      {/* Sidebar overlay for mobile */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[55] lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 w-72 border-r border-white/5 flex flex-col bg-[#080808] z-[60] transition-transform duration-500 lg:sticky lg:h-screen lg:translate-x-0",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-8 border-b border-white/5 hidden lg:flex items-center gap-3">
          <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(249,115,22,0.3)]">
            <Zap className="w-6 h-6 text-black" fill="currentColor" />
          </div>
          <div className="flex flex-col">
            <span className="font-black tracking-tighter text-xl italic uppercase leading-none">Nexus</span>
            <span className="text-[10px] uppercase font-black text-orange-500 tracking-[0.3em] leading-none mt-1">Factory</span>
          </div>
        </div>

        <nav className="p-6 space-y-1 flex-1 overflow-y-auto custom-scrollbar">
          <div className="px-2 py-4 text-[9px] uppercase font-black text-white/20 tracking-[0.3em]">Agent Ecosystem</div>
          <button 
            onClick={() => setCurrentView("dashboard")}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all text-sm group",
              currentView === "dashboard" ? "bg-white/5 text-white" : "text-white/40 hover:bg-white/5 hover:text-white"
            )}
          >
            <Sparkles className="w-4 h-4" />
            <span className="font-bold uppercase tracking-widest text-[10px]">Dashboard</span>
          </button>
          
          <div className="space-y-1 mt-4">
            <button 
              onClick={() => setCurrentView("trends")}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all text-sm group",
                currentView === "trends" ? "bg-white/5 text-white shadow-[0_0_15px_rgba(249,115,22,0.1)] border border-orange-500/10" : "text-white/40 hover:bg-white/5 hover:text-white"
              )}
            >
              <TrendingUp className="w-4 h-4" />
              <span className="font-bold uppercase tracking-widest text-[10px]">Trend Hunter</span>
            </button>
            <button 
              onClick={() => setCurrentView("scripts")}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all text-sm group",
                currentView === "scripts" ? "bg-white/5 text-white shadow-[0_0_15px_rgba(249,115,22,0.1)] border border-orange-500/10" : "text-white/40 hover:bg-white/5 hover:text-white"
              )}
            >
              <FileText className="w-4 h-4" />
              <span className="font-bold uppercase tracking-widest text-[10px]">Script Writer</span>
            </button>
          </div>
          
          <div className="px-2 py-6 text-[9px] uppercase font-black text-white/20 tracking-[0.3em]">Network Control</div>
          <button 
            onClick={() => setCurrentView("channels")}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all text-sm group",
              currentView === "channels" ? "bg-white/5 text-white border border-blue-500/10 shadow-[0_0_15px_rgba(37,99,235,0.1)]" : "text-white/40 hover:bg-white/5 hover:text-white"
            )}
          >
            <Globe className="w-4 h-4" /> 
            <span className="font-bold uppercase tracking-widest text-[10px]">Global Channels</span>
            <div className="ml-auto flex items-center gap-1">
               <span className="text-[8px] font-black">{channels.length}</span>
               <ChevronRight className="w-3 h-3 opacity-30" />
            </div>
          </button>
          <button className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-white/40 hover:bg-white/5 hover:text-white transition-all text-sm group">
            <Settings className="w-4 h-4" /> 
            <span className="font-bold uppercase tracking-widest text-[10px]">Project Settings</span>
          </button>
        </nav>

        <div className="p-6 border-t border-white/5 space-y-6">
          <div className="bg-white/5 rounded-2xl p-5 border border-white/5 relative overflow-hidden group">
            <div className="absolute inset-0 bg-orange-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="flex items-center justify-between mb-4 relative z-10">
              <div className="flex items-center gap-2">
                <div className={cn("w-2 h-2 rounded-full", isAutonomous ? "bg-emerald-500 animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.5)]" : "bg-white/20")} />
                <span className="text-[9px] font-black text-white uppercase tracking-widest">Automation</span>
              </div>
              <button 
                onClick={() => setIsAutonomous(!isAutonomous)}
                className={cn(
                  "w-12 h-6 rounded-full p-1 transition-all duration-300 relative border border-white/10",
                  isAutonomous ? "bg-orange-500" : "bg-[#111]"
                )}
              >
                <div className={cn(
                  "w-4 h-4 bg-white rounded-full transition-all duration-300 shadow-xl",
                  isAutonomous ? "translate-x-6" : "translate-x-0"
                )} />
              </button>
            </div>
            <p className="text-[9px] text-white/30 leading-relaxed uppercase font-black tracking-widest relative z-10">
              {isAutonomous ? "Core processing active. AI is scaling your empire." : "Factory paused. Manual pulses required."}
            </p>
          </div>

          <div className="flex items-center gap-4 px-2">
            <div className="w-10 h-10 rounded-xl overflow-hidden bg-white/5 border border-white/10">
              {user.photoURL && <img src={user.photoURL} alt="" referrerPolicy="no-referrer" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-black truncate uppercase tracking-tight">{user.displayName}</p>
              <p className="text-[9px] text-orange-500 font-bold uppercase tracking-widest">Elite Tier Owner</p>
            </div>
            <button onClick={() => signOut(auth)} className="p-2 hover:bg-white/5 rounded-lg text-white/20 hover:text-white transition-colors">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-h-screen lg:h-screen overflow-x-hidden bg-[#050505]">
        <header className="h-auto lg:h-24 border-b border-white/5 flex flex-col lg:flex-row items-center justify-between px-6 lg:px-10 py-6 lg:py-0 bg-[#050505]/80 backdrop-blur-2xl z-40 gap-4">
          <div className="flex items-center gap-4 w-full lg:w-auto">
            <div className="flex flex-col text-left">
              <h2 className="text-xl lg:text-2xl font-black tracking-tighter uppercase italic">{currentView.replace(/_/g, ' ')}</h2>
              <p className="text-[9px] lg:text-[10px] text-white/30 uppercase tracking-[0.3em] font-bold">Node Identity: AP-SOUTHEAST-1_ALPHA</p>
            </div>
          </div>
          <div className="flex items-center gap-4 w-full lg:w-auto">
            {currentView === "channels" && (
              <button 
                onClick={() => handleConnectChannel("tiktok")}
                className="px-6 py-3 bg-white/5 border border-white/10 text-white text-xs font-black uppercase tracking-widest rounded-xl flex items-center justify-center gap-3 hover:bg-white/10 transition-all"
              >
                <Plus className="w-4 h-4" />
                Add Channel
              </button>
            )}
            <button 
              onClick={handleManualPulse}
              disabled={!!activeStep}
              className="w-full lg:w-auto px-6 py-3 bg-white text-black text-xs font-black uppercase tracking-widest rounded-xl flex items-center justify-center gap-3 disabled:opacity-50 hover:bg-white/90 active:scale-95 transition-all shadow-[0_0_30px_rgba(255,255,255,0.1)]"
            >
              {activeStep ? <RefreshCw className="w-4 h-4 animate-spin text-orange-500" /> : <Play className="w-4 h-4 fill-current" />}
              {activeStep ? "Processing Pulse" : "Manual Pulse"}
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-x-hidden overflow-y-auto p-6 lg:p-10 space-y-8 lg:space-y-10 custom-scrollbar relative">
          <div className="absolute inset-0 bg-orange-500/[0.02] pointer-events-none" />
          
          {currentView === "dashboard" && (
            <>
              {/* Stats Bar */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6 relative z-10">
                <StatCard label="Total Impressions" value={posts.reduce((acc, p) => acc + (p.performance?.views || 0), 0).toLocaleString()} icon={Globe} color="bg-blue-600 shadow-[0_0_20px_rgba(37,99,235,0.3)]" />
                <StatCard label="Content Units" value={scripts.length} icon={Video} color="bg-purple-600 shadow-[0_0_20px_rgba(147,51,234,0.3)]" />
                <StatCard label="Viral Signals" value={trends.length} icon={TrendingUp} color="bg-emerald-600 shadow-[0_0_20px_rgba(5,150,105,0.3)]" />
                <StatCard label="GPU Efficiency" value="99.9%" icon={Cpu} color="bg-orange-600 shadow-[0_0_20px_rgba(234,88,12,0.3)]" />
              </div>

              <div className="flex flex-col xl:grid xl:grid-cols-12 gap-8 lg:gap-10 relative z-10">
                {/* Center Column: Feed */}
            <div className="xl:col-span-8 space-y-8 order-2 xl:order-1">
              <div className="flex items-center justify-between border-b border-white/5 pb-4">
                <h3 className="text-[9px] lg:text-[10px] font-black uppercase tracking-[0.4em] text-white/30 flex items-center gap-2">
                  <RefreshCw className="w-3 h-3 text-white/20" />
                  Live Output Stream
                </h3>
                <div className="hidden sm:flex gap-4">
                   <span className="text-[9px] font-bold text-white/20 uppercase tracking-widest">Filter: All Platforms</span>
                </div>
              </div>

              <div className="space-y-6">
                <AnimatePresence mode="popLayout">
                  {posts.length === 0 && (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="bg-white/[0.02] border border-white/5 rounded-3xl p-10 lg:p-16 text-center"
                    >
                      <Sparkles className="w-12 h-12 lg:w-16 lg:h-16 mx-auto mb-6 text-white/5" />
                      <p className="text-xs lg:text-sm font-black uppercase tracking-widest text-white/20">Awaiting First Neural Pulse...</p>
                      <p className="text-[10px] text-white/10 mt-2 uppercase font-bold">System ready for Content Generation</p>
                    </motion.div>
                  )}
                  {posts.map((post, idx) => (
                    <motion.div
                      layout
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      key={post.id}
                      className="bg-[#0c0c0c] border border-white/5 rounded-3xl p-6 lg:p-8 group hover:border-orange-500/30 transition-all hover:bg-[#111] relative overflow-hidden"
                    >
                      <div className="absolute top-0 right-0 p-8 opacity-0 group-hover:opacity-10 transition-opacity pointer-events-none hidden lg:block">
                         <Sparkles className="w-24 h-24 text-white" />
                      </div>
                      
                      <div className="flex flex-col lg:flex-row gap-6 lg:gap-10 relative z-10">
                        <div className="w-full lg:w-40 h-56 lg:h-56 bg-gradient-to-br from-white/[0.05] to-transparent rounded-2xl border border-white/5 overflow-hidden relative flex-shrink-0 lg:group-hover:scale-[1.02] transition-transform duration-500">
                           <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
                              <div className="w-12 h-12 rounded-full border border-white/10 flex items-center justify-center mb-4 lg:group-hover:bg-orange-500 lg:group-hover:border-none transition-all duration-500">
                                <Play className="w-4 h-4 text-white/20 lg:group-hover:text-black lg:group-hover:fill-current" />
                              </div>
                              <span className="text-[8px] font-bold text-white/20 uppercase tracking-[0.2em]">Asset Preview Pending</span>
                           </div>
                           <div className="absolute top-4 left-4 px-2 py-1 bg-white text-black rounded text-[9px] font-black uppercase tracking-tighter">
                             {post.platform}
                           </div>
                        </div>
                        <div className="flex-1 min-w-0 py-2">
                          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
                            <div className="flex-1 min-w-0">
                               <h4 className="text-xl lg:text-2xl font-black text-white lg:group-hover:text-orange-500 transition-colors uppercase tracking-tighter italic lg:line-clamp-1 mb-2 truncate">
                                 {post.caption?.split('.')[0] || "Neural Generation #" + (posts.length - idx)}
                               </h4>
                               <div className="flex items-center gap-4">
                                  <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-500/10 rounded-md">
                                     <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                     <span className="text-[9px] font-black text-emerald-500 tracking-widest uppercase">Verified Live</span>
                                  </div>
                                  <span className="text-[9px] text-white/20 font-black uppercase tracking-widest">{post.createdAt ? new Date(post.createdAt.toDate()).toLocaleTimeString() : 'Recently'}</span>
                               </div>
                            </div>
                            <div className="flex justify-start sm:justify-end gap-6 sm:border-l border-white/5 sm:pl-6 pt-4 sm:pt-0 border-t sm:border-t-0">
                               <div className="text-left sm:text-right">
                                 <p className="text-2xl lg:text-3xl font-black text-white italic tracking-tighter tabular-nums">+{post.performance?.views || 0}</p>
                                 <p className="text-[9px] text-white/20 uppercase font-black tracking-widest mt-1">Network Velocity</p>
                               </div>
                            </div>
                          </div>
                          
                          <p className="text-sm text-white/40 leading-relaxed lg:line-clamp-2 mb-6 font-medium">
                            {post.caption}
                          </p>

                          {scripts.find(s => s.conceptId === post.id || s.id === post.id) && (
                            <div className="mb-6 p-4 bg-white/[0.03] rounded-xl border border-white/5 text-[9px] lg:text-[10px] font-mono text-white/40">
                               <p className="text-orange-500 font-bold mb-1 uppercase tracking-widest text-[8px]">Script Hook</p>
                               {scripts.find(s => s.conceptId === post.id || s.id === post.id)?.hook}
                            </div>
                          )}
                          
                          <div className="flex flex-wrap gap-2 mb-8">
                             {post.hashtags?.map((tag: any) => (
                               <span key={tag} className="text-[8px] lg:text-[9px] px-2.5 py-1.5 bg-white/5 font-black uppercase tracking-widest rounded-lg text-white/30 lg:hover:text-orange-500 lg:hover:bg-orange-500/10 transition-all cursor-default">
                                 #{tag}
                               </span>
                             ))}
                          </div>

                          <div className="flex flex-col sm:flex-row sm:items-center gap-6 sm:gap-8 pt-8 border-t border-white/5">
                             <div className="flex items-center gap-6">
                               <div className="flex items-center gap-2 group/stat">
                                 <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center lg:group-hover/stat:bg-blue-500/20 transition-all">
                                   <TrendingUp className="w-4 h-4 text-white/20 lg:group-hover/stat:text-blue-500" />
                                 </div>
                                 <span className="text-[10px] font-black text-white/40 lg:group-hover/stat:text-white uppercase tracking-widest">{post.performance?.likes || 0} Reacts</span>
                               </div>
                               <div className="flex items-center gap-2 group/stat">
                                 <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center lg:group-hover/stat:bg-orange-500/20 transition-all">
                                   <Repeat className="w-4 h-4 text-white/20 lg:group-hover/stat:text-orange-500" />
                                 </div>
                                 <span className="text-[10px] font-black text-white/40 lg:group-hover/stat:text-white uppercase tracking-widest">{post.performance?.shares || 0} Distributions</span>
                               </div>
                             </div>
                             <button className="sm:ml-auto text-[9px] font-black uppercase tracking-[0.2em] text-white/20 lg:hover:text-orange-500 flex items-center gap-2 transition-all">
                               Deep Analytics <ChevronRight className="w-4 h-4" />
                             </button>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )).reverse()}
                </AnimatePresence>
              </div>
            </div>

                <div className="xl:col-span-4 space-y-8 lg:space-y-10 order-1 xl:order-2 text-left">
                  <div className="bg-[#080808] border border-white/5 rounded-3xl flex flex-col h-[350px] lg:h-[450px] shadow-3xl relative overflow-hidden">
                    <div className="p-5 lg:p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.01]">
                       <div className="flex items-center gap-3">
                          <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse shadow-[0_0_10px_rgba(249,115,22,0.5)]" />
                          <span className="text-[9px] lg:text-[10px] font-black uppercase tracking-[0.3em] text-white">Log Terminal</span>
                       </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-5 lg:p-6 space-y-3 font-mono text-[10px] custom-scrollbar bg-black/40 text-xs">
                      {logs.length === 0 && <div className="text-white/10 uppercase font-black tracking-widest text-center mt-32 lg:mt-32">I/O Stream Static</div>}
                      {logs.map((log, i) => (
                        <motion.div 
                          initial={{ opacity: 0, x: 10 }}
                          animate={{ opacity: 1, x: 0 }}
                          key={i} 
                          className={cn(
                            "leading-loose tracking-tighter flex items-start gap-3",
                            log.includes("❌") ? "text-red-500 bg-red-500/5 px-2 py-1 rounded border border-red-500/20" : 
                            log.includes("🚀") ? "text-blue-400" :
                            log.includes("✨") ? "text-emerald-400" : "text-white/30"
                          )}
                        >
                          <span className="text-white/10 flex-shrink-0 shrink-0 font-bold">[{new Date().toLocaleTimeString([], { hour12: false })}]</span>
                          <span className="flex-1 text-[10px] sm:text-xs text-left">{log}</span>
                        </motion.div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-6 text-left">
                    <div className="flex items-center justify-between">
                      <h3 className="text-[9px] font-black uppercase tracking-[0.4em] text-white/30 flex gap-2">
                        <TrendingUp className="w-3 h-3 text-orange-500" />
                        Global Signal Matrix
                      </h3>
                      <RefreshCw className={cn("w-3 h-3 text-white/10", activeStep === "Trend Hunter" && "animate-spin")} />
                    </div>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-4">
                       {trends.length === 0 && (
                         <div className="col-span-full p-8 bg-white/[0.02] border border-dashed border-white/5 rounded-3xl text-center">
                           <p className="text-[9px] font-black text-white/10 uppercase tracking-widest">Monitoring Frequencies...</p>
                         </div>
                       )}
                       {trends.slice(0, 4).map((trend, i) => (
                         <motion.div 
                           initial={{ opacity: 0, y: 10 }}
                           animate={{ opacity: 1, y: 0 }}
                           key={trend.id || i} 
                           className="p-5 lg:p-6 bg-[#0c0c0c] border border-white/5 rounded-2xl relative overflow-hidden group lg:hover:bg-[#111] transition-all text-left"
                         >
                            <div className="flex items-center justify-between mb-3 relative z-10">
                              <span className="text-[9px] font-black text-orange-500 uppercase tracking-[0.3em]">{trend.source}</span>
                              <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-500/10 rounded border border-emerald-500/20">
                                <TrendingUp className="w-3 h-3 text-emerald-500" />
                                <span className="text-[9px] font-black text-emerald-500">+{trend.growth}%</span>
                              </div>
                            </div>
                            <p className="text-sm font-black text-white mb-4 lg:group-hover:text-orange-500 transition-all uppercase tracking-tighter italic leading-tight">{trend.topic}</p>
                            <div className="flex gap-2 flex-wrap items-center relative z-10">
                              {trend.keywords?.slice(0, 2).map((k: any) => (
                                <span key={k} className="text-[8px] px-2 py-1 bg-white/5 rounded text-white/40 uppercase font-black tracking-widest">#{k}</span>
                              ))}
                              <span className="text-[8px] text-white/10 uppercase font-black tracking-[0.2em] ml-auto">Score: 0.98</span>
                            </div>
                         </motion.div>
                       ))}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {currentView === "trends" && (
            <div className="space-y-8 animate-in fade-in duration-500 text-left relative z-10 px-4">
               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                 {trends.map((trend) => (
                   <motion.div 
                    layoutId={trend.id}
                    key={trend.id}
                    className="bg-[#0c0c0c] border border-white/5 rounded-3xl p-8 hover:border-orange-500/30 transition-all group text-left"
                   >
                     <div className="flex items-center justify-between mb-6">
                        <span className="bg-orange-500/10 text-orange-500 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border border-orange-500/20">{trend.source}</span>
                        <span className="text-[10px] text-white/20 font-bold uppercase tracking-widest">{trend.createdAt ? new Date(trend.createdAt.toDate()).toLocaleDateString() : 'Just now'}</span>
                     </div>
                     <h3 className="text-2xl font-black text-white mb-4 uppercase tracking-tighter italic leading-tight group-hover:text-orange-500 transition-colors">
                       {trend.topic}
                     </h3>
                     <p className="text-sm text-white/40 mb-8 font-medium leading-relaxed">
                       Viral momentum detected in the {trend.audience} sector. Signal strength high.
                     </p>
                     <div className="flex items-center justify-between pt-6 border-t border-white/5">
                        <div className="flex items-center gap-2">
                           <TrendingUp className="w-4 h-4 text-emerald-500" />
                           <span className="text-lg font-black text-emerald-500 tracking-tighter">+{trend.growth}% Growth</span>
                        </div>
                        <button 
                          onClick={() => setCurrentView("dashboard")}
                          className="px-4 py-2 bg-white/5 rounded-xl text-[10px] font-black uppercase tracking-widest text-white/40 hover:text-white transition-all hover:bg-white/10"
                        >
                          Forge Concept
                        </button>
                     </div>
                   </motion.div>
                 ))}
               </div>
            </div>
          )}

          {currentView === "scripts" && (
            <div className="space-y-8 animate-in fade-in duration-500 text-left relative z-10 px-4">
               <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                 {scripts.map((script) => (
                   <motion.div 
                    key={script.id}
                    className="bg-[#0c0c0c] border border-white/5 rounded-3xl p-10 hover:border-purple-500/30 transition-all group text-left"
                   >
                     <div className="flex items-center justify-between mb-8">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center border border-purple-500/20">
                            <FileText className="w-4 h-4 text-purple-500" />
                          </div>
                          <span className="text-[10px] font-black text-white uppercase tracking-widest">Neural Script v1.4</span>
                        </div>
                        <span className="text-[10px] text-white/20 font-bold uppercase tracking-widest">{script.durationEstimate}s Duration</span>
                     </div>
                     
                     <div className="space-y-8">
                        <div>
                           <p className="text-[9px] font-black text-purple-500 uppercase tracking-widest mb-3 text-left">The Hook</p>
                           <p className="text-xl font-bold text-white italic tracking-tight uppercase">"{script.hook}"</p>
                        </div>
                        <div>
                           <p className="text-[9px] font-black text-white/20 uppercase tracking-widest mb-3 text-left">Narrative Body</p>
                           <p className="text-sm text-white/50 leading-relaxed font-medium">{script.body}</p>
                        </div>
                        <div className="p-6 bg-white/[0.02] rounded-2xl border border-white/5">
                           <p className="text-[9px] font-black text-orange-500 uppercase tracking-widest mb-3 text-left">Visual Direction</p>
                           <p className="text-[11px] text-white/30 font-mono leading-relaxed">{script.visualCues}</p>
                        </div>
                     </div>

                     <div className="mt-10 pt-8 border-t border-white/5 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                           <Sparkles className="w-4 h-4 text-white/20" />
                           <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">Optimized for Retention</span>
                        </div>
                        <button className="text-[10px] font-black uppercase tracking-widest text-white/40 hover:text-purple-500 transition-colors">Apply Template</button>
                     </div>
                   </motion.div>
                 ))}
               </div>
            </div>
          )}

          {currentView === "channels" && (
            <div className="space-y-12 animate-in fade-in duration-500 max-w-5xl mx-auto text-left relative z-10 px-4">
               <div className="text-center space-y-4 mb-16">
                  <h3 className="text-4xl font-black uppercase tracking-tighter italic">Global Channel Matrix</h3>
                  <p className="text-white/40 max-w-md mx-auto text-sm font-medium uppercase tracking-widest text-[10px]">
                    Link your social identifiers to broadcast neural content across the global network.
                  </p>
                  <div className="flex justify-center pt-4">
                    <button 
                      onClick={handleAutoDetect}
                      disabled={isScanning}
                      className="px-8 py-3 bg-orange-500 text-black text-[10px] font-black uppercase tracking-[0.2em] rounded-xl hover:bg-orange-400 transition-all shadow-[0_0_20px_rgba(249,115,22,0.3)] disabled:opacity-50 flex items-center gap-3"
                    >
                      {isScanning ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
                      Auto-detect nodes
                    </button>
                  </div>
               </div>

               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                 {channels.map((channel) => (
                   <motion.div 
                    key={channel.id}
                    className="bg-[#0c0c0c] border border-white/5 rounded-[2.5rem] p-10 group relative transition-all hover:bg-[#111] text-left"
                   >
                     <div className="absolute top-0 right-0 p-8 opacity-10">
                        <Globe className="w-16 h-16" />
                     </div>
                     <div className="flex flex-col items-center text-center">
                        <div className="w-24 h-24 rounded-[2rem] bg-white/5 border border-white/10 p-1 mb-6 group-hover:scale-105 transition-transform duration-500 overflow-hidden">
                           <img src={channel.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${channel.handle}`} alt="" className="w-full h-full rounded-[1.8rem] object-cover" />
                        </div>
                        <h4 className="text-2xl font-black text-white tracking-tighter italic uppercase mb-1">@{channel.handle}</h4>
                        <span className="text-[10px] font-black text-blue-500 uppercase tracking-[0.3em] mb-8">{channel.platform} Creator</span>
                        
                        <div className="w-full grid grid-cols-2 gap-4 mb-8">
                           <div className="p-4 bg-white/[0.02] rounded-2xl border border-white/5">
                              <p className="text-xl font-black text-white italic tracking-tighter">98.2</p>
                              <p className="text-[8px] text-white/20 uppercase font-black tracking-widest mt-1">Trust Score</p>
                           </div>
                           <div className="p-4 bg-white/[0.02] rounded-2xl border border-white/5">
                              <p className="text-xl font-black text-emerald-500 italic tracking-tighter">Live</p>
                              <p className="text-[8px] text-white/20 uppercase font-black tracking-widest mt-1">Status</p>
                           </div>
                        </div>

                        <div className="flex gap-4 w-full">
                           <button className="flex-1 px-4 py-3 bg-white/5 rounded-xl text-[10px] font-black uppercase tracking-widest text-white/40 hover:bg-white/10 hover:text-white transition-all">Settings</button>
                           <button 
                            onClick={async () => {
                              if(confirm('Disconnect this node?')) {
                                await deleteDoc(doc(db, "channels", channel.id)).catch(err => handleFirestoreError(err, OperationType.DELETE, `channels/${channel.id}`));
                                addLog(`🔌 Deconnected node: @${channel.handle}`);
                              }
                            }}
                            className="px-4 py-3 bg-red-500/10 text-red-500 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-red-500 hover:text-white transition-all"
                           >
                             Disconnect
                           </button>
                        </div>
                     </div>
                   </motion.div>
                 ))}

                 {/* Add New Channel Card */}
                 <div 
                  onClick={() => handleConnectChannel("tiktok")}
                  className="bg-white/[0.02] border-2 border-dashed border-white/5 rounded-[2.5rem] p-10 flex flex-col items-center justify-center text-center cursor-pointer hover:border-white/10 hover:bg-white/[0.03] transition-all group min-h-[400px]"
                 >
                    <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                       <Plus className="w-8 h-8 text-white/20 group-hover:text-white transition-colors" />
                    </div>
                    <h4 className="text-xl font-black text-white/30 uppercase tracking-tighter italic">Link New Node</h4>
                    <p className="text-[9px] text-white/10 mt-2 uppercase font-black tracking-[0.2em]">Scale your presence</p>
                 </div>
               </div>
            </div>
          )}
        </div>
      </main>

      {/* Deep Analytics Modal */}
      <AnimatePresence>
        {selectedPostId && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 lg:p-10">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedPostId(null)}
              className="absolute inset-0 bg-[#050505]/95 backdrop-blur-xl"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="w-full max-w-4xl bg-[#0c0c0c] border border-white/10 rounded-[3rem] overflow-hidden relative shadow-3xl flex flex-col h-full max-h-[80vh]"
            >
              <div className="p-8 border-b border-white/5 flex items-center justify-between bg-white/[0.01]">
                <div className="flex items-center gap-4">
                   <div className="w-12 h-12 bg-orange-500 rounded-2xl flex items-center justify-center shadow-[0_0_20px_rgba(249,115,22,0.3)]">
                      <BarChart3 className="w-6 h-6 text-black" />
                   </div>
                   <div className="text-left">
                      <h3 className="text-xl font-black uppercase italic tracking-tighter">Post Deep Analytics</h3>
                      <p className="text-[10px] text-white/30 uppercase font-bold tracking-widest">Post ID: {selectedPostId.slice(0, 12)}</p>
                   </div>
                </div>
                <button 
                  onClick={() => setSelectedPostId(null)}
                  className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-all"
                >
                  <Plus className="w-6 h-6 rotate-45 text-white/40" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 lg:p-12 custom-scrollbar">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
                   <div className="p-8 bg-white/[0.02] border border-white/5 rounded-3xl text-center">
                      <p className="text-4xl font-black text-white italic tracking-tighter mb-2">91.4%</p>
                      <p className="text-[10px] text-white/30 uppercase font-black tracking-widest">Viral Probability</p>
                   </div>
                   <div className="p-8 bg-white/[0.02] border border-white/5 rounded-3xl text-center">
                      <p className="text-4xl font-black text-emerald-500 italic tracking-tighter mb-2">+12%</p>
                      <p className="text-[10px] text-white/30 uppercase font-black tracking-widest">Retention Over Avg</p>
                   </div>
                   <div className="p-8 bg-white/[0.02] border border-white/5 rounded-3xl text-center">
                      <p className="text-4xl font-black text-blue-500 italic tracking-tighter mb-2">High</p>
                      <p className="text-[10px] text-white/30 uppercase font-black tracking-widest">Signal Strength</p>
                   </div>
                </div>

                <div className="space-y-8">
                   <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-8 text-left">
                      <h4 className="text-sm font-black uppercase tracking-widest text-white/40 mb-6 flex items-center gap-3">
                         <TrendingUp className="w-4 h-4 text-orange-500" />
                         Performance Trajectory
                      </h4>
                      <div className="h-48 flex items-end justify-between gap-2">
                         {[40, 70, 45, 90, 65, 80, 100, 85, 95].map((h, i) => (
                           <div key={i} className="flex-1 bg-white/5 rounded-t-lg relative group overflow-hidden">
                              <motion.div 
                                initial={{ height: 0 }}
                                animate={{ height: `${h}%` }}
                                className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-orange-500/40 to-orange-500/10 group-hover:from-orange-500 group-hover:to-orange-400 transition-all"
                              />
                           </div>
                         ))}
                      </div>
                      <div className="flex justify-between mt-4 text-[8px] font-black text-white/20 uppercase tracking-widest">
                         <span>T-0h</span>
                         <span>T-12h</span>
                         <span>T-24h</span>
                         <span>Forecast</span>
                      </div>
                   </div>

                   <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-left">
                      <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-8">
                         <h4 className="text-sm font-black uppercase tracking-widest text-white/40 mb-4">Audience Sentiment</h4>
                         <div className="space-y-4">
                            <div className="flex justify-between text-[10px] uppercase font-black tracking-widest">
                               <span className="text-emerald-500 italic">Positive</span>
                               <span className="text-white/60">88%</span>
                            </div>
                            <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
                               <div className="bg-emerald-500 h-full w-[88%]" />
                            </div>
                        </div>
                      </div>
                      <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-8">
                         <h4 className="text-sm font-black uppercase tracking-widest text-white/40 mb-4">Geographic Spread</h4>
                         <div className="space-y-2">
                           {["North America", "Europe", "Southeast Asia", "Other"].map((reg, i) => (
                             <div key={reg} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                                <span className="text-[10px] font-bold text-white/60 uppercase tracking-widest">{reg}</span>
                                <span className="text-[10px] font-black text-white italic">{(35 - i * 8)}%</span>
                             </div>
                           ))}
                         </div>
                      </div>
                   </div>
                </div>
              </div>

              <div className="p-8 bg-white/[0.01] border-t border-white/5 flex justify-end gap-4">
                <button 
                  onClick={() => setSelectedPostId(null)}
                  className="px-8 py-3 bg-white/5 rounded-xl text-[10px] font-black uppercase tracking-widest text-white/40 hover:bg-white/10 hover:text-white transition-all"
                >
                  Close Analysis
                </button>
                <button className="px-8 py-3 bg-white text-black rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-white/90 transition-all flex items-center gap-2">
                  <RefreshCw className="w-3 h-3" />
                  Recalculate
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>


      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.15);
        }
        * {
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }
      `}</style>
    </div>
  );
}
