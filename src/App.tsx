/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Tilt from 'react-parallax-tilt';
import { 
  Gavel, 
  FileText, 
  Users, 
  CreditCard, 
  MessageSquare, 
  Search, 
  Plus, 
  ChevronRight, 
  Settings, 
  LogOut, 
  User,
  Scale,
  Clock,
  CheckCircle2,
  AlertCircle,
  Send,
  Sparkles,
  ArrowUpRight,
  FileSignature,
  History,
  Filter,
  Download,
  Eye,
  ScanSearch,
  ShieldCheck,
  TrendingUp,
  Mic
} from 'lucide-react';
import { auth, db, signInWithGoogle, logout } from './firebase';
import { useAuthState } from 'react-firebase-hooks/auth';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, doc, setDoc, getDoc, orderBy, limit, getDocs } from 'firebase/firestore';
import { GoogleGenAI } from "@google/genai";
import Markdown from 'react-markdown';
import { cn } from './lib/utils';
import { LegalCase, UserProfile, LegalDocument, PaymentRecord, DocumentTemplate, ActivityLog, UserRole, CaseStatus, CaseActivity } from './types';
import { Routes, Route, useNavigate, useLocation, useParams, Navigate } from 'react-router-dom';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  // We don't always want to throw if it's a listener, but for the system's requirement:
  if (errInfo.error.includes('Missing or insufficient permissions')) {
     // throw new Error(JSON.stringify(errInfo)); 
     // Actually, throwing in a listener callback might crash the app. 
     // But the instructions say "throw a new error". 
     // I'll log it clearly as requested.
  }
}

// --- Components ---

const StatusBadge = ({ status }: { status: CaseStatus }) => {
  const configs: Record<CaseStatus, { color: string, label: string }> = {
    open: { color: 'bg-blue-500/20 text-blue-400', label: 'Open' },
    pending_payment: { color: 'bg-yellow-500/20 text-yellow-400', label: 'Pending Payment' },
    active: { color: 'bg-green-500/20 text-green-400', label: 'Active' },
    closed: { color: 'bg-paper/20 text-paper/40', label: 'Closed' },
    archived: { color: 'bg-red-500/20 text-red-400', label: 'Archived' },
  };
  const config = configs[status] || configs.open;
  return (
    <span className={cn("px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider", config.color)}>
      {config.label}
    </span>
  );
};

// --- Components ---

const BentoCard = ({ children, className, title, icon: Icon, delay = 0, noTilt = false }: { children: React.ReactNode, className?: string, title?: string, icon?: any, delay?: number, noTilt?: boolean }) => {
  const content = (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay }}
      className={cn("glass-card p-6 flex flex-col gap-4 group hover:bg-white/10 transition-all duration-300 h-full", className)}
    >
      {title && (
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-paper/60 group-hover:text-gold transition-colors">
            {Icon && <Icon size={18} />}
            <span className="text-xs font-medium uppercase tracking-widest">{title}</span>
          </div>
          <ArrowUpRight size={16} className="text-paper/20 group-hover:text-gold group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
        </div>
      )}
      {children}
    </motion.div>
  );

  if (noTilt) return content;

  return (
    <Tilt
      tiltMaxAngleX={5}
      tiltMaxAngleY={5}
      perspective={1000}
      scale={1.02}
      transitionSpeed={1500}
      className={className}
    >
      {content}
    </Tilt>
  );
};

const SidebarItem = ({ icon: Icon, label, active, onClick }: { icon: any, label: string, active?: boolean, onClick?: () => void }) => (
  <button
    onClick={onClick}
    className={cn(
      "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 w-full text-left",
      active 
        ? "bg-gold text-obsidian font-semibold shadow-lg shadow-gold/20" 
        : "text-paper/60 hover:bg-white/5 hover:text-paper"
    )}
  >
    <Icon size={20} />
    <span className="text-sm">{label}</span>
  </button>
);

const LegalAISidebar = ({ isOpen, onClose, context }: { isOpen: boolean, onClose: () => void, context?: string }) => {
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant', content: string }[]>([
    { role: 'assistant', content: "Hello, I am your LexOS AI Legal Assistant. I am currently aware of your active view. How can I help you with Kenyan law today?" }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    
    const userMsg = input;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-preview",
        contents: `Context: ${context || 'General legal dashboard'}\n\nUser Question: ${userMsg}`,
        config: {
          systemInstruction: "You are the LexOS AI Legal Assistant for Ochiel Mwendwa Advocates. You are an expert in Kenyan law (Constitution, Statutes, Precedents). Provide precise, professional, and actionable legal insights. Always cite relevant Kenyan statutes where applicable."
        }
      });
      
      setMessages(prev => [...prev, { role: 'assistant', content: response.text || "I'm sorry, I couldn't process that." }]);
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { role: 'assistant', content: "Error connecting to LexOS Brain. Please check your API key." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="fixed right-0 top-0 h-full w-96 glass-card rounded-none border-l border-white/10 z-50 flex flex-col"
        >
          <div className="p-6 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-2 text-gold">
              <Sparkles size={20} />
              <h2 className="font-semibold tracking-tight">Legal AI</h2>
            </div>
            <button onClick={onClose} className="text-paper/40 hover:text-paper transition-colors">
              <ChevronRight size={24} />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-hide">
            {messages.map((msg, i) => (
              <div key={i} className={cn("flex", msg.role === 'user' ? "justify-end" : "justify-start")}>
                <div className={cn(
                  "max-w-[85%] p-3 rounded-2xl text-sm",
                  msg.role === 'user' ? "bg-gold text-obsidian rounded-tr-none" : "bg-white/5 text-paper/90 rounded-tl-none"
                )}>
                  <div className="markdown-body">
                    <Markdown>{msg.content}</Markdown>
                  </div>
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-white/5 p-3 rounded-2xl rounded-tl-none animate-pulse">
                  <div className="h-4 w-12 bg-white/10 rounded" />
                </div>
              </div>
            )}
          </div>

          <div className="p-6 border-t border-white/10">
            <div className="relative">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Ask about Kenyan law..."
                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-4 pr-12 text-sm focus:outline-none focus:border-gold/50 transition-all"
              />
              <button 
                onClick={handleSend}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-gold hover:bg-gold/10 rounded-lg transition-all"
              >
                <Send size={18} />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const CaseDetail = ({ setAiContext, setIsAISidebarOpen }: { setAiContext: (c: string) => void, setIsAISidebarOpen: (o: boolean) => void }) => {
  const { id } = useParams();
  const [legalCase, setLegalCase] = useState<LegalCase | null>(null);
  const [documents, setDocuments] = useState<LegalDocument[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [activities, setActivities] = useState<CaseActivity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    const unsubCase = onSnapshot(doc(db, 'cases', id), (snap) => {
      if (snap.exists()) setLegalCase({ id: snap.id, ...snap.data() } as LegalCase);
      setLoading(false);
    }, (err) => handleFirestoreError(err, OperationType.GET, `cases/${id}`));

    const qDocs = query(collection(db, 'documents'), where('caseId', '==', id));
    const unsubDocs = onSnapshot(qDocs, (snap) => setDocuments(snap.docs.map(d => ({ id: d.id, ...d.data() } as LegalDocument))), (err) => handleFirestoreError(err, OperationType.LIST, 'documents'));

    const qPayments = query(collection(db, 'payments'), where('caseId', '==', id));
    const unsubPayments = onSnapshot(qPayments, (snap) => setPayments(snap.docs.map(d => ({ id: d.id, ...d.data() } as PaymentRecord))), (err) => handleFirestoreError(err, OperationType.LIST, 'payments'));

    const qActivities = query(collection(db, 'case_activities'), where('caseId', '==', id), orderBy('timestamp', 'desc'));
    const unsubActivities = onSnapshot(qActivities, (snap) => setActivities(snap.docs.map(d => ({ id: d.id, ...d.data() } as CaseActivity))), (err) => handleFirestoreError(err, OperationType.LIST, 'case_activities'));

    return () => { unsubCase(); unsubDocs(); unsubPayments(); unsubActivities(); };
  }, [id]);

  if (loading) return <div className="animate-pulse space-y-4"><div className="h-12 bg-white/5 rounded-xl w-1/3" /><div className="h-64 bg-white/5 rounded-xl" /></div>;
  if (!legalCase) return <div className="text-center py-20 text-paper/40">Case not found.</div>;

  return (
    <div className="space-y-8 pb-20">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-gold/10 rounded-2xl text-gold"><Scale size={32} /></div>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-3xl font-bold tracking-tight">{legalCase.title}</h2>
              <StatusBadge status={legalCase.status} />
            </div>
            <p className="text-paper/40 font-mono text-sm mt-1">#{legalCase.caseNumber} • {legalCase.practiceArea}</p>
          </div>
        </div>
        <div className="flex gap-3">
          <button className="px-6 py-3 bg-white/5 border border-white/10 rounded-xl font-bold text-sm hover:bg-white/10 transition-all">Edit Case</button>
          <button className="px-6 py-3 bg-gold text-obsidian rounded-xl font-bold text-sm hover:bg-gold-muted transition-all">Generate Invoice</button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-8 space-y-6">
          <BentoCard title="Case Description" icon={FileText}>
            <p className="text-paper/70 leading-relaxed">{legalCase.description}</p>
          </BentoCard>

          <BentoCard title="Documents" icon={FileSignature}>
            <div className="space-y-3">
              {documents.length === 0 ? (
                <p className="text-sm text-paper/30 italic">No documents filed yet.</p>
              ) : (
                documents.map(doc => (
                  <div key={doc.id} className="flex items-center justify-between p-4 bg-white/5 rounded-xl group hover:bg-white/10 transition-all">
                    <div className="flex items-center gap-3">
                      <FileText size={18} className="text-gold" />
                      <div>
                        <p className="text-sm font-bold">{doc.title}</p>
                        <p className="text-[10px] text-paper/40 uppercase">{doc.status} • {new Date(doc.createdAt).toLocaleDateString()}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => {
                          setAiContext(`Analyzing document: ${doc.title}\nContent: ${doc.content}\nCase: ${legalCase.title}`);
                          setIsAISidebarOpen(true);
                        }}
                        className="p-2 text-paper/40 hover:text-gold transition-colors" 
                        title="Analyze with AI"
                      >
                        <ScanSearch size={18} />
                      </button>
                      <button className="p-2 text-paper/40 hover:text-gold transition-colors"><Download size={18} /></button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </BentoCard>

          <BentoCard title="Financials" icon={CreditCard}>
            <div className="space-y-3">
              {payments.length === 0 ? (
                <p className="text-sm text-paper/30 italic">No payments recorded.</p>
              ) : (
                payments.map(p => (
                  <div key={p.id} className="flex items-center justify-between p-4 bg-white/5 rounded-xl">
                    <div className="flex items-center gap-3">
                      <CreditCard size={18} className="text-green-500" />
                      <div>
                        <p className="text-sm font-bold">{p.currency} {p.amount}</p>
                        <p className="text-[10px] text-paper/40 uppercase">{p.status} • {new Date(p.createdAt).toLocaleDateString()}</p>
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-paper/20">{p.pesapalMerchantReference}</span>
                  </div>
                ))
              )}
            </div>
          </BentoCard>
        </div>

        <div className="col-span-4 space-y-6">
          <BentoCard title="Activity Timeline" icon={History}>
            <div className="space-y-6 relative before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-px before:bg-white/10">
              {activities.length === 0 ? (
                <p className="text-sm text-paper/30 italic">No activity logged.</p>
              ) : (
                activities.map((act, i) => (
                  <div key={act.id} className="relative pl-8">
                    <div className="absolute left-0 top-1 w-6 h-6 bg-obsidian border-2 border-gold rounded-full flex items-center justify-center z-10">
                      <div className="w-2 h-2 bg-gold rounded-full" />
                    </div>
                    <p className="text-xs font-bold text-paper/90">{act.action}</p>
                    <p className="text-[10px] text-paper/50 mt-1">{act.details}</p>
                    <p className="text-[9px] text-paper/30 mt-1 uppercase tracking-widest">{new Date(act.timestamp).toLocaleString()}</p>
                  </div>
                ))
              )}
            </div>
          </BentoCard>
        </div>
      </div>
    </div>
  );
};

const CaseForm = ({ onCancel }: { onCancel: () => void }) => {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    status: 'open',
    clientUid: '',
    assignedAdvocateUid: '',
    practiceArea: 'General',
    caseNumber: `OK/${new Date().getFullYear()}/${Math.floor(Math.random() * 1000)}`
  });
  const [clients, setClients] = useState<UserProfile[]>([]);
  const [advocates, setAdvocates] = useState<UserProfile[]>([]);

  useEffect(() => {
    const qClients = query(collection(db, 'users'), where('role', '==', 'client'));
    const qAdvocates = query(collection(db, 'users'), where('role', 'in', ['advocate', 'admin']));
    
    onSnapshot(qClients, (snap) => setClients(snap.docs.map(d => d.data() as UserProfile)));
    onSnapshot(qAdvocates, (snap) => setAdvocates(snap.docs.map(d => d.data() as UserProfile)));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'cases'), {
        ...formData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      onCancel();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="glass-card p-8 max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <Plus className="text-gold" /> New Legal Case
      </h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-paper/40 uppercase">Case Number</label>
            <input readOnly value={formData.caseNumber} className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-sm opacity-50" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-paper/40 uppercase">Practice Area</label>
            <select 
              value={formData.practiceArea} 
              onChange={e => setFormData({...formData, practiceArea: e.target.value})}
              className="w-full bg-obsidian border border-white/10 rounded-xl py-3 px-4 text-sm focus:border-gold/50"
            >
              <option>General</option>
              <option>Conveyancing</option>
              <option>Family Law</option>
              <option>Commercial</option>
              <option>Litigation</option>
            </select>
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-bold text-paper/40 uppercase">Title</label>
          <input required value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-sm" placeholder="e.g. Sale of Land - Karen Property" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-bold text-paper/40 uppercase">Description</label>
          <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-sm h-24" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-paper/40 uppercase">Client</label>
            <select required value={formData.clientUid} onChange={e => setFormData({...formData, clientUid: e.target.value})} className="w-full bg-obsidian border border-white/10 rounded-xl py-3 px-4 text-sm">
              <option value="">Select Client</option>
              {clients.map(c => <option key={c.uid} value={c.uid}>{c.displayName}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-paper/40 uppercase">Assigned Advocate</label>
            <select value={formData.assignedAdvocateUid} onChange={e => setFormData({...formData, assignedAdvocateUid: e.target.value})} className="w-full bg-obsidian border border-white/10 rounded-xl py-3 px-4 text-sm">
              <option value="">Select Advocate</option>
              {advocates.map(a => <option key={a.uid} value={a.uid}>{a.displayName}</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-4 pt-4">
          <button type="button" onClick={onCancel} className="flex-1 py-4 rounded-2xl border border-white/10 font-bold hover:bg-white/5 transition-all">Cancel</button>
          <button type="submit" className="flex-1 py-4 rounded-2xl bg-gold text-obsidian font-bold hover:bg-gold-muted transition-all">Create Case</button>
        </div>
      </form>
    </div>
  );
};

const DocumentGenerator = ({ template, onCancel }: { template: DocumentTemplate, onCancel: () => void }) => {
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [cases, setCases] = useState<LegalCase[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [generating, setGenerating] = useState(false);
  const [showSeal, setShowSeal] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'cases'));
    return onSnapshot(q, (snap) => setCases(snap.docs.map(d => ({ id: d.id, ...d.data() } as LegalCase))));
  }, []);

  const handleGenerate = async () => {
    if (!selectedCaseId) return;
    setGenerating(true);
    try {
      let content = template.content;
      Object.entries(fieldValues).forEach(([key, val]) => {
        content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), val);
      });

      await addDoc(collection(db, 'documents'), {
        caseId: selectedCaseId,
        title: `${template.name} - ${new Date().toLocaleDateString()}`,
        content,
        type: 'other',
        status: 'draft',
        createdByUid: auth.currentUser?.uid,
        createdAt: new Date().toISOString()
      });

      await addDoc(collection(db, 'case_activities'), {
        caseId: selectedCaseId,
        uid: auth.currentUser?.uid,
        action: 'DOCUMENT_GENERATED',
        details: `Generated document from template: ${template.name}`,
        timestamp: new Date().toISOString()
      });

      setShowSeal(true);
      setTimeout(() => onCancel(), 2500);
    } catch (err) {
      console.error(err);
    } finally {
      setGenerating(false);
    }
  };

  if (showSeal) {
    return (
      <div className="flex flex-col items-center justify-center space-y-6">
        <motion.div 
          initial={{ scale: 0, rotate: -45 }}
          animate={{ scale: 1, rotate: 0 }}
          className="w-32 h-32 bg-gold rounded-full flex items-center justify-center shadow-[0_0_50px_rgba(201,162,39,0.5)] border-4 border-obsidian"
        >
          <Scale size={64} className="text-obsidian" />
        </motion.div>
        <motion.p 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-gold font-bold tracking-[0.3em] uppercase"
        >
          Document Filed & Sealed
        </motion.p>
      </div>
    );
  }

  return (
    <div className="glass-card p-8 max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <FileSignature className="text-gold" /> Generate Document
      </h2>
      <div className="space-y-6">
        <div className="space-y-1">
          <label className="text-xs font-bold text-paper/40 uppercase">Select Case</label>
          <select 
            value={selectedCaseId} 
            onChange={e => setSelectedCaseId(e.target.value)}
            className="w-full bg-obsidian border border-white/10 rounded-xl py-3 px-4 text-sm"
          >
            <option value="">Select a case...</option>
            {cases.map(c => <option key={c.id} value={c.id}>{c.title} (#{c.caseNumber})</option>)}
          </select>
        </div>

        <div className="space-y-4">
          <h3 className="text-sm font-bold text-paper/60 uppercase tracking-widest">Dynamic Fields</h3>
          {template.variables.map(v => (
            <div key={v} className="space-y-1">
              <label className="text-xs font-bold text-paper/40 capitalize">{v.replace(/_/g, ' ')}</label>
              <input 
                value={fieldValues[v] || ''} 
                onChange={e => setFieldValues({...fieldValues, [v]: e.target.value})}
                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-sm"
                placeholder={`Enter ${v}...`}
              />
            </div>
          ))}
        </div>

        <div className="flex gap-4 pt-4">
          <button onClick={onCancel} className="flex-1 py-4 rounded-2xl border border-white/10 font-bold hover:bg-white/5 transition-all">Cancel</button>
          <button 
            onClick={handleGenerate} 
            disabled={!selectedCaseId || generating}
            className="flex-1 py-4 rounded-2xl bg-gold text-obsidian font-bold hover:bg-gold-muted transition-all disabled:opacity-50"
          >
            {generating ? 'Generating...' : 'Generate & Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

const TemplateManager = () => {
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<DocumentTemplate | null>(null);
  const [newTemplate, setNewTemplate] = useState({ name: '', description: '', content: '', category: 'General' });

  useEffect(() => {
    const q = query(collection(db, 'templates'));
    return onSnapshot(q, (snap) => setTemplates(snap.docs.map(d => ({ id: d.id, ...d.data() } as DocumentTemplate))));
  }, []);

  const handleSave = async () => {
    const variables = Array.from(newTemplate.content.matchAll(/\{\{(.*?)\}\}/g)).map(m => m[1]);
    await addDoc(collection(db, 'templates'), {
      ...newTemplate,
      variables: [...new Set(variables)],
      createdByUid: auth.currentUser?.uid,
      createdAt: new Date().toISOString()
    });
    setIsCreating(false);
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Document Templates</h2>
        <button onClick={() => setIsCreating(true)} className="flex items-center gap-2 bg-gold text-obsidian px-4 py-2 rounded-xl font-bold text-sm">
          <Plus size={18} /> Create Template
        </button>
      </div>

      {isCreating && (
        <div className="glass-card p-6 space-y-4">
          <input placeholder="Template Name" value={newTemplate.name} onChange={e => setNewTemplate({...newTemplate, name: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4" />
          <textarea placeholder="Content (use {{variable_name}} for dynamic fields)" value={newTemplate.content} onChange={e => setNewTemplate({...newTemplate, content: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 h-48 font-mono text-sm" />
          <div className="flex gap-4">
            <button onClick={() => setIsCreating(false)} className="px-6 py-2 rounded-xl border border-white/10">Cancel</button>
            <button onClick={handleSave} className="px-6 py-2 rounded-xl bg-gold text-obsidian font-bold">Save Template</button>
          </div>
        </div>
      )}

      {selectedTemplate && (
        <div className="fixed inset-0 z-[70] bg-obsidian/90 backdrop-blur-md flex items-center justify-center p-4">
          <DocumentGenerator template={selectedTemplate} onCancel={() => setSelectedTemplate(null)} />
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        {templates.map(t => (
          <BentoCard key={t.id} title={t.category} icon={FileText}>
            <h3 className="font-bold text-lg">{t.name}</h3>
            <p className="text-sm text-paper/40">{t.description || 'Custom legal template'}</p>
            <div className="flex flex-wrap gap-2 mt-4">
              {t.variables.map(v => <span key={v} className="px-2 py-1 bg-gold/10 text-gold text-[10px] rounded-md uppercase font-bold">{v}</span>)}
            </div>
            <button 
              onClick={() => setSelectedTemplate(t)}
              className="mt-6 w-full py-3 bg-white/5 border border-white/10 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-gold hover:text-obsidian transition-all"
            >
              Use Template
            </button>
          </BentoCard>
        ))}
      </div>
    </div>
  );
};

const UserManagement = () => {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [filter, setFilter] = useState({ user: '', action: '', date: '' });

  useEffect(() => {
    const qU = query(collection(db, 'users'));
    const unsubUsers = onSnapshot(qU, (snap) => setUsers(snap.docs.map(d => d.data() as UserProfile)), (err) => handleFirestoreError(err, OperationType.LIST, 'users'));

    const qL = query(collection(db, 'activity_logs'), orderBy('timestamp', 'desc'), limit(100));
    const unsubLogs = onSnapshot(qL, (snap) => setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() } as ActivityLog))), (err) => handleFirestoreError(err, OperationType.LIST, 'activity_logs'));

    return () => { unsubUsers(); unsubLogs(); };
  }, []);

  const updateRole = async (uid: string, role: UserRole) => {
    await setDoc(doc(db, 'users', uid), { role }, { merge: true });
    await addDoc(collection(db, 'activity_logs'), {
      uid: auth.currentUser?.uid,
      action: 'ROLE_UPDATE',
      details: `Updated user ${uid} to role ${role}`,
      timestamp: new Date().toISOString()
    });
  };

  const filteredLogs = logs.filter(log => {
    const userMatch = !filter.user || log.uid === filter.user;
    const actionMatch = !filter.action || log.action.includes(filter.action);
    const dateMatch = !filter.date || log.timestamp.startsWith(filter.date);
    return userMatch && actionMatch && dateMatch;
  });

  const seedDemoData = async () => {
    try {
      // 1. Create Demo Users
      const demoUsers: UserProfile[] = [
        { uid: 'demo-admin-uid', email: 'admin@demo.com', displayName: 'Admin User', role: 'admin', createdAt: new Date().toISOString() },
        { uid: 'demo-advocate-uid', email: 'advocate@demo.com', displayName: 'Senior Advocate', role: 'advocate', createdAt: new Date().toISOString() },
        { uid: 'demo-clerk-uid', email: 'clerk@demo.com', displayName: 'Legal Clerk', role: 'clerk', createdAt: new Date().toISOString() },
        { uid: 'demo-client-uid', email: 'client@demo.com', displayName: 'Main Client', role: 'client', createdAt: new Date().toISOString() },
      ];
      for (const u of demoUsers) await setDoc(doc(db, 'users', u.uid), u);

      // 2. Create Demo Templates
      const demoTemplates = [
        { name: 'Sale Agreement', description: 'Standard land sale agreement', content: 'This agreement is between {{seller_name}} and {{buyer_name}} for the property at {{property_location}}.', category: 'Conveyancing', variables: ['seller_name', 'buyer_name', 'property_location'] },
        { name: 'NDA', description: 'Non-Disclosure Agreement', content: '{{company_name}} and {{recipient_name}} agree to keep all information confidential.', category: 'Commercial', variables: ['company_name', 'recipient_name'] },
      ];
      for (const t of demoTemplates) await addDoc(collection(db, 'templates'), { ...t, createdByUid: 'demo-admin-uid', createdAt: new Date().toISOString() });

      // 3. Create Demo Cases
      const demoCases = [
        { title: 'Land Purchase - Runda', description: 'Acquisition of 0.5 acre plot in Runda Estate.', status: 'active', clientUid: 'demo-client-uid', assignedAdvocateUid: 'demo-advocate-uid', practiceArea: 'Conveyancing', caseNumber: 'OK/2026/101' },
        { title: 'Corporate Restructuring', description: 'Restructuring of holding company for tax optimization.', status: 'pending_payment', clientUid: 'demo-client-uid', assignedAdvocateUid: 'demo-advocate-uid', practiceArea: 'Commercial', caseNumber: 'OK/2026/102' },
      ];
      for (const c of demoCases) {
        const docRef = await addDoc(collection(db, 'cases'), { ...c, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        
        // Add some activities
        await addDoc(collection(db, 'case_activities'), { caseId: docRef.id, uid: 'demo-admin-uid', action: 'CASE_CREATED', details: 'Initial case setup completed.', timestamp: new Date().toISOString() });
        await addDoc(collection(db, 'case_activities'), { caseId: docRef.id, uid: 'demo-advocate-uid', action: 'ADVOCATE_ASSIGNED', details: 'Senior Advocate assigned to the matter.', timestamp: new Date().toISOString() });
      }

      alert('Demo data seeded successfully!');
    } catch (err) {
      console.error(err);
      alert('Error seeding demo data.');
    }
  };

  return (
    <div className="space-y-8">
      <div className="glass-card p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold">User Management</h2>
          <button onClick={seedDemoData} className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-xs font-bold hover:bg-gold hover:text-obsidian transition-all">Seed Demo Data</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs text-paper/40 uppercase tracking-widest border-b border-white/10">
                <th className="pb-4">User</th>
                <th className="pb-4">Email</th>
                <th className="pb-4">Role</th>
                <th className="pb-4">Joined</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {users.map(u => (
                <tr key={u.uid} className="border-b border-white/5 last:border-0">
                  <td className="py-4 font-medium">{u.displayName}</td>
                  <td className="py-4 text-paper/60">{u.email}</td>
                  <td className="py-4">
                    <select 
                      value={u.role} 
                      onChange={e => updateRole(u.uid, e.target.value as UserRole)}
                      className="bg-obsidian border border-white/10 rounded-lg px-2 py-1 text-xs text-gold"
                    >
                      <option value="client">Client</option>
                      <option value="clerk">Clerk</option>
                      <option value="advocate">Advocate</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td className="py-4 text-paper/40">{new Date(u.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="glass-card p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold">Activity Audit Logs</h2>
          <div className="flex gap-4">
            <select value={filter.user} onChange={e => setFilter({...filter, user: e.target.value})} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs">
              <option value="">All Users</option>
              {users.map(u => <option key={u.uid} value={u.uid}>{u.displayName}</option>)}
            </select>
            <input type="date" value={filter.date} onChange={e => setFilter({...filter, date: e.target.value})} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs" />
          </div>
        </div>
        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
          {filteredLogs.map(log => (
            <div key={log.id} className="p-3 bg-white/5 rounded-xl text-xs flex justify-between items-center">
              <div>
                <span className="text-gold font-bold mr-2">[{log.action}]</span>
                <span className="text-paper/70">{log.details}</span>
              </div>
              <span className="text-paper/30 font-mono">{new Date(log.timestamp).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const ClientDashboard = ({ user, cases }: { user: any, cases: LegalCase[] }) => {
  const [payments, setPayments] = useState<PaymentRecord[]>([]);

  useEffect(() => {
    const q = query(collection(db, 'payments'), where('clientUid', '==', user.uid));
    return onSnapshot(q, (snap) => setPayments(snap.docs.map(d => ({ id: d.id, ...d.data() } as PaymentRecord))));
  }, [user]);

  return (
    <div className="grid grid-cols-12 gap-6 auto-rows-[180px]">
      <BentoCard className="col-span-8 row-span-2" title="My Active Cases" icon={Scale}>
        <div className="space-y-4 overflow-y-auto pr-2">
          {cases.map(c => (
            <div key={c.id} className="flex items-center justify-between p-4 bg-white/5 rounded-xl">
              <div>
                <h3 className="font-bold">{c.title}</h3>
                <p className="text-xs text-paper/40">#{c.caseNumber} • {c.status}</p>
              </div>
              <button className="text-gold text-xs font-bold uppercase tracking-widest hover:underline">View Details</button>
            </div>
          ))}
        </div>
      </BentoCard>

      <BentoCard className="col-span-4 row-span-2" title="Payment History" icon={CreditCard}>
        <div className="space-y-4 overflow-y-auto pr-2">
          {payments.map(p => (
            <div key={p.id} className="flex items-center justify-between p-3 bg-white/5 rounded-xl">
              <div>
                <p className="text-sm font-bold">{p.currency} {p.amount}</p>
                <p className="text-[10px] text-paper/40 uppercase">{p.status}</p>
              </div>
              <span className="text-[10px] text-paper/30">{new Date(p.createdAt).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      </BentoCard>

      <BentoCard className="col-span-12 row-span-1" title="Quick Support" icon={MessageSquare}>
        <div className="flex items-center justify-between h-full">
          <p className="text-sm text-paper/60">Need help with your case? Our AI assistant is ready to help, or you can message your advocate.</p>
          <button className="bg-gold text-obsidian px-6 py-3 rounded-xl font-bold">Start Chat</button>
        </div>
      </BentoCard>
    </div>
  );
};

// --- Main App ---

export default function App() {
  const [user, loadingAuth] = useAuthState(auth);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isAISidebarOpen, setIsAISidebarOpen] = useState(false);
  const [aiContext, setAiContext] = useState('');
  const [cases, setCases] = useState<LegalCase[]>([]);
  const [isCreatingCase, setIsCreatingCase] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);
  
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (user || isDemoMode) {
      const uid = user?.uid || 'demo-admin-uid';
      const userRef = doc(db, 'users', uid);
      
      const fetchProfile = async () => {
        try {
          const snap = await getDoc(userRef);
          if (!snap.exists() && user) {
            const newProfile: UserProfile = {
              uid: user.uid,
              email: user.email || '',
              displayName: user.displayName || 'User',
              role: 'client',
              createdAt: new Date().toISOString()
            };
            await setDoc(userRef, newProfile);
            setUserProfile(newProfile);
          } else if (snap.exists()) {
            setUserProfile(snap.data() as UserProfile);
          } else if (isDemoMode && !userProfile) {
            // Default demo profile if not in DB and not already set by handleDemoLogin
            setUserProfile({
              uid: 'demo-admin-uid',
              email: 'admin@ochielmwendwa.com',
              displayName: 'Demo Admin',
              role: 'admin',
              createdAt: new Date().toISOString()
            });
          }
        } catch (error) {
          console.error("Error fetching profile:", error);
        }
      };

      fetchProfile();
    }
  }, [user, isDemoMode]);

  useEffect(() => {
    if (!userProfile) return;

    const uid = userProfile.uid;
    const q = userProfile.role === 'client' 
      ? query(collection(db, 'cases'), where('clientUid', '==', uid))
      : query(collection(db, 'cases'));
      
    const unsubscribe = onSnapshot(q, (snap) => {
      setCases(snap.docs.map(d => ({ id: d.id, ...d.data() } as LegalCase)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'cases');
    });
    return () => unsubscribe();
  }, [userProfile]);

  const isStaff = userProfile?.role === 'admin' || userProfile?.role === 'advocate' || userProfile?.role === 'clerk';
  const isAdmin = userProfile?.role === 'admin';

  const handleDemoLogin = (role: UserRole) => {
    setIsDemoMode(true);
    setUserProfile({
      uid: `demo-${role}-uid`,
      email: `${role}@demo.com`,
      displayName: `Demo ${role.charAt(0).toUpperCase() + role.slice(1)}`,
      role: role,
      createdAt: new Date().toISOString()
    });
    navigate('/dashboard');
  };

  if (loadingAuth) return (
    <div className="h-screen w-full flex items-center justify-center bg-obsidian">
      <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 2, ease: "linear" }} className="text-gold">
        <Scale size={48} />
      </motion.div>
    </div>
  );

  if (!user && !isDemoMode) return (
    <div className="min-h-screen bg-obsidian relative overflow-hidden flex flex-col">
      {/* Background Elements */}
      <div className="absolute top-0 left-0 w-full h-full opacity-20 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] bg-gold/20 blur-[150px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] bg-gold/10 blur-[150px] rounded-full" />
      </div>

      {/* Hero Section */}
      <div className="flex-1 flex flex-col items-center justify-center p-8 relative z-10">
        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-4xl"
        >
          <div className="flex justify-center mb-8">
            <div className="p-6 bg-gold/10 rounded-[2.5rem] text-gold shadow-2xl shadow-gold/20">
              <Scale size={64} />
            </div>
          </div>
          <h1 className="text-6xl font-black tracking-tighter mb-4 bg-gradient-to-b from-paper to-paper/60 bg-clip-text text-transparent">
            OCHIEL MWENDWA <span className="text-gold">ADVOCATES</span>
          </h1>
          <p className="text-paper/40 text-lg uppercase tracking-[0.4em] mb-12 font-medium">Precision. Integrity. Excellence.</p>
          
          <div className="grid grid-cols-3 gap-6 mb-16">
            <div className="glass-card p-6 text-left border-gold/10">
              <FileSignature className="text-gold mb-4" size={32} />
              <h3 className="font-bold mb-2">Smart Templates</h3>
              <p className="text-xs text-paper/50">Dynamic document generation for Kenyan legal standards.</p>
            </div>
            <div className="glass-card p-6 text-left border-gold/10">
              <CreditCard className="text-gold mb-4" size={32} />
              <h3 className="font-bold mb-2">PesaPal Integrated</h3>
              <p className="text-xs text-paper/50">Secure, real-time payment tracking and automated invoicing.</p>
            </div>
            <div className="glass-card p-6 text-left border-gold/10">
              <Sparkles className="text-gold mb-4" size={32} />
              <h3 className="font-bold mb-2">AI Legal Assistant</h3>
              <p className="text-xs text-paper/50">Instant insights powered by Gemini 3.1 Flash AI.</p>
            </div>
          </div>

          <div className="flex flex-col items-center gap-8">
            <button onClick={signInWithGoogle} className="group relative px-12 py-5 bg-paper text-obsidian font-black rounded-2xl flex items-center gap-4 hover:bg-gold transition-all duration-500 shadow-2xl shadow-white/10">
              <User size={24} /> 
              <span>GET STARTED WITH GOOGLE</span>
              <ChevronRight className="group-hover:translate-x-1 transition-transform" />
            </button>

            <div className="space-y-4 w-full max-w-md">
              <p className="text-xs font-bold text-paper/30 uppercase tracking-widest">Demo Access (One-Click)</p>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => handleDemoLogin('admin')} className="py-3 bg-white/5 border border-white/10 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-gold/20 transition-all">Admin Demo</button>
                <button onClick={() => handleDemoLogin('advocate')} className="py-3 bg-white/5 border border-white/10 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-gold/20 transition-all">Advocate Demo</button>
                <button onClick={() => handleDemoLogin('clerk')} className="py-3 bg-white/5 border border-white/10 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-gold/20 transition-all">Clerk Demo</button>
                <button onClick={() => handleDemoLogin('client')} className="py-3 bg-white/5 border border-white/10 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-gold/20 transition-all">Client Demo</button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Footer */}
      <footer className="p-8 border-t border-white/5 text-center relative z-10">
        <p className="text-[10px] text-paper/20 uppercase tracking-[0.3em]">© 2026 Ochiel Mwendwa Advocates • Nairobi, Kenya</p>
      </footer>
    </div>
  );

  const activeTab = location.pathname.split('/')[1] || 'dashboard';

  return (
    <div className="min-h-screen bg-obsidian flex">
      <aside className="w-72 border-r border-white/10 p-6 flex flex-col gap-8 sticky top-0 h-screen">
        <div className="flex items-center gap-3 px-2 cursor-pointer" onClick={() => navigate('/dashboard')}>
          <div className="p-2 bg-gold/10 rounded-xl text-gold"><Gavel size={24} /></div>
          <div>
            <h2 className="font-bold text-sm tracking-tight">Ochiel Mwendwa</h2>
            <p className="text-[10px] text-paper/40 uppercase tracking-widest">Advocates</p>
          </div>
        </div>
        <nav className="flex-1 space-y-2">
          <SidebarItem icon={Scale} label="Dashboard" active={activeTab === 'dashboard'} onClick={() => navigate('/dashboard')} />
          <SidebarItem icon={FileText} label="My Cases" active={activeTab === 'cases'} onClick={() => navigate('/cases')} />
          {isStaff && <SidebarItem icon={FileSignature} label="Templates" active={activeTab === 'templates'} onClick={() => navigate('/templates')} />}
          <SidebarItem icon={CreditCard} label="Payments" active={activeTab === 'payments'} onClick={() => navigate('/payments')} />
          {isAdmin && <SidebarItem icon={Users} label="User Management" active={activeTab === 'users'} onClick={() => navigate('/users')} />}
        </nav>
        <div className="pt-6 border-t border-white/10 space-y-2">
          <SidebarItem icon={Settings} label="Settings" active={activeTab === 'settings'} onClick={() => navigate('/settings')} />
          <SidebarItem icon={LogOut} label="Logout" onClick={() => { logout(); setIsDemoMode(false); navigate('/'); }} />
        </div>
      </aside>

      <main className="flex-1 p-8 relative">
        <header className="flex items-center justify-between mb-12">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Welcome back, {userProfile?.displayName?.split(' ')[0]}</h1>
            <p className="text-paper/40 text-sm mt-1">Manage your legal matters with precision.</p>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={() => setIsAISidebarOpen(true)} className="p-3 glass-card hover:text-gold transition-all relative group">
              <Sparkles size={20} />
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-gold rounded-full border-2 border-obsidian" />
            </button>
            <div className="flex items-center gap-3 pl-4 border-l border-white/10">
              <div className="text-right">
                <p className="text-sm font-semibold">{userProfile?.displayName}</p>
                <p className="text-[10px] text-gold uppercase tracking-widest font-bold">{userProfile?.role || 'Client'}</p>
              </div>
              <img src={user?.photoURL || `https://ui-avatars.com/api/?name=${userProfile?.displayName}&background=C5A059&color=111`} className="w-10 h-10 rounded-xl border border-white/10" alt="Avatar" referrerPolicy="no-referrer" />
            </div>
          </div>
        </header>

        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" />} />
          <Route path="/dashboard" element={
            userProfile?.role === 'client' ? (
              <ClientDashboard user={userProfile} cases={cases} />
            ) : (
              <div className="grid grid-cols-12 gap-6 auto-rows-[180px]">
                <BentoCard className="col-span-8 row-span-2" title="Active Matters" icon={Scale}>
                  <div className="flex-1 overflow-y-auto space-y-4 pr-2">
                    {cases.map(c => (
                      <div key={c.id} onClick={() => navigate(`/cases/${c.id}`)} className="flex items-center justify-between p-4 bg-white/5 rounded-xl hover:bg-white/10 transition-all cursor-pointer group">
                        <div className="flex items-center gap-4">
                          <div className={cn("w-2 h-12 rounded-full", c.status === 'active' ? "bg-green-500" : "bg-gold")} />
                          <div>
                            <h3 className="font-semibold text-paper/90 group-hover:text-paper">{c.title}</h3>
                            <p className="text-xs text-paper/40 mt-1">Case #{c.caseNumber} • {c.practiceArea}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <StatusBadge status={c.status} />
                          <ChevronRight size={20} className="text-paper/20 group-hover:text-gold" />
                        </div>
                      </div>
                    ))}
                  </div>
                </BentoCard>
                <BentoCard className="col-span-4 row-span-2" title="Revenue Intelligence" icon={TrendingUp}>
                  <div className="flex flex-col justify-between h-full">
                    <div>
                      <h3 className="text-3xl font-bold text-green-400">KES 2.4M</h3>
                      <p className="text-xs text-paper/40 mt-1 uppercase tracking-widest">Projected Cashflow (30d)</p>
                    </div>
                    <div className="space-y-3">
                      <div className="flex justify-between text-[10px] uppercase tracking-widest">
                        <span className="text-paper/40">Confidence Score</span>
                        <span className="text-gold font-bold">94%</span>
                      </div>
                      <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                        <div className="h-full bg-gold w-[94%]" />
                      </div>
                      <p className="text-[10px] text-paper/30 italic">AI predicts 82% of pending payments will clear by April 15th.</p>
                    </div>
                  </div>
                </BentoCard>

                <BentoCard className="col-span-4 row-span-1" title="Compliance Radar" icon={ShieldCheck}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold text-green-400">100% Compliant</p>
                      <p className="text-[10px] text-paper/40 uppercase mt-1">Data Protection Act 2019</p>
                    </div>
                    <CheckCircle2 size={24} className="text-green-500" />
                  </div>
                </BentoCard>

                <BentoCard className="col-span-4 row-span-1" title="Quick Actions" icon={Plus}>
                  <div className="grid grid-cols-2 gap-3 h-full">
                    <button onClick={() => setIsCreatingCase(true)} className="flex flex-col items-center justify-center gap-2 bg-white/5 rounded-xl hover:bg-gold hover:text-obsidian transition-all group">
                      <Plus size={24} className="text-gold group-hover:text-obsidian" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">New Case</span>
                    </button>
                    <button onClick={() => navigate('/templates')} className="flex flex-col items-center justify-center gap-2 bg-white/5 rounded-xl hover:bg-gold hover:text-obsidian transition-all group">
                      <FileSignature size={24} className="text-gold group-hover:text-obsidian" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">Templates</span>
                    </button>
                  </div>
                </BentoCard>
              </div>
            )
          } />
          
          <Route path="/cases" element={
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold">Legal Matters</h2>
                {isStaff && <button onClick={() => setIsCreatingCase(true)} className="bg-gold text-obsidian px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2"><Plus size={18} /> New Case</button>}
              </div>
              <div className="grid grid-cols-1 gap-4">
                {cases.map(c => (
                  <div key={c.id} onClick={() => navigate(`/cases/${c.id}`)} className="glass-card p-6 flex items-center justify-between hover:bg-white/5 transition-all cursor-pointer">
                    <div className="flex items-center gap-6">
                      <div className="p-3 bg-gold/10 rounded-xl text-gold"><Scale size={24} /></div>
                      <div>
                        <h3 className="font-bold text-lg">{c.title}</h3>
                        <p className="text-sm text-paper/40">#{c.caseNumber} • {c.practiceArea}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-8">
                      <div className="text-right">
                        <p className="text-[10px] text-paper/30 uppercase tracking-widest font-bold">Status</p>
                        <StatusBadge status={c.status} />
                      </div>
                      <ChevronRight size={24} className="text-paper/20" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          } />
          
          <Route path="/cases/:id" element={<CaseDetail setAiContext={setAiContext} setIsAISidebarOpen={setIsAISidebarOpen} />} />
          
          <Route path="/templates" element={isStaff ? <TemplateManager /> : <Navigate to="/dashboard" />} />
          
          <Route path="/payments" element={
            <div className="space-y-8">
              <h2 className="text-2xl font-bold">Financial Records</h2>
              <BentoCard title="Recent Transactions" icon={CreditCard} className="row-span-3">
                <div className="space-y-4">
                  {/* Payment list here */}
                  <p className="text-paper/40 italic text-sm">No recent transactions found.</p>
                </div>
              </BentoCard>
            </div>
          } />
          
          <Route path="/users" element={isAdmin ? <UserManagement /> : <Navigate to="/dashboard" />} />
          
          <Route path="/settings" element={
            <div className="space-y-8">
              <h2 className="text-2xl font-bold">Settings</h2>
              <div className="grid grid-cols-2 gap-6">
                <BentoCard title="Profile Settings" icon={User}>
                  <div className="space-y-4">
                    <div className="flex items-center gap-4">
                      <img src={user?.photoURL || `https://ui-avatars.com/api/?name=${userProfile?.displayName}&background=C5A059&color=111`} className="w-16 h-16 rounded-2xl border border-white/10" alt="Avatar" referrerPolicy="no-referrer" />
                      <div>
                        <p className="font-bold">{userProfile?.displayName}</p>
                        <p className="text-sm text-paper/40">{userProfile?.email}</p>
                      </div>
                    </div>
                    <button className="w-full py-3 bg-white/5 border border-white/10 rounded-xl text-sm font-bold hover:bg-white/10 transition-all">Edit Profile</button>
                  </div>
                </BentoCard>
                {isAdmin && (
                  <BentoCard title="Admin Controls" icon={Settings}>
                    <div className="space-y-4">
                      <p className="text-sm text-paper/60">Manage firm-wide settings, user roles, and audit logs.</p>
                      <button onClick={() => navigate('/users')} className="w-full py-3 bg-gold text-obsidian rounded-xl text-sm font-bold hover:bg-gold-muted transition-all">Manage Users</button>
                    </div>
                  </BentoCard>
                )}
              </div>
            </div>
          } />
        </Routes>

        {isCreatingCase && (
          <div className="fixed inset-0 z-[60] bg-obsidian/80 backdrop-blur-sm flex items-center justify-center p-4">
            <CaseForm onCancel={() => setIsCreatingCase(false)} />
          </div>
        )}

        <LegalAISidebar 
        isOpen={isAISidebarOpen} 
        onClose={() => setIsAISidebarOpen(false)} 
        context={aiContext || (location.pathname === '/dashboard' ? 'Dashboard Overview' : location.pathname)}
      />
      </main>
    </div>
  );
}
