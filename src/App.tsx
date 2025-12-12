import React, { useState, useRef, useEffect } from 'react';
import { Upload, Wand2, Download, RefreshCw, X, FolderInput, Layers, AlertCircle, Maximize2, CheckSquare, Square, FilePlus, RotateCcw, ShieldAlert, FolderTree, Archive, Settings, Key } from 'lucide-react';

// --- Interface ---
interface WorkItem {
  id: string;
  file: File;
  relativePath: string;
  previewUrl: string;
  resultUrl: string | null;
  status: 'pending' | 'processing' | 'completed' | 'error' | 'fallback';
  errorMsg?: string;
  type: 'detected' | 'unknown'; 
}

export default function App() {
  // --- State ---
  // API Key Management: Load from local storage or empty
  const [userApiKey, setUserApiKey] = useState<string>(() => {
    try {
      return localStorage.getItem('gemini_user_api_key') || '';
    } catch (e) {
      return '';
    }
  });
  const [showSettings, setShowSettings] = useState(false);

  const [items, setItems] = useState<WorkItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [activeTab, setActiveTab] = useState<'upload' | 'results'>('upload');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  // Design Configuration
  const [modelPrompt, setModelPrompt] = useState("Korean female model, soft facial features, natural dark hair, elegant and trendy Korean beauty aesthetic");
  const [bgPrompt, setBgPrompt] = useState("warm cozy indoor living room, soft warm lighting, beige and brown tones, comfortable atmosphere, depth of field");
  
  const consistencyLock = useRef<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // --- Init ---
  useEffect(() => {
    consistencyLock.current = "Specific features: Oval face shape, slight natural makeup, straight long black hair parting in the middle, small beauty mark under left eye, calm expression.";
    
    // Load external libs
    const loadExternalLibs = () => {
      // @ts-ignore
      if (!window.tailwind) {
        const script = document.createElement('script');
        script.src = "https://cdn.tailwindcss.com";
        document.head.appendChild(script);
      }
      // @ts-ignore
      if (!window.JSZip) {
        const script = document.createElement('script');
        script.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
        document.head.appendChild(script);
      }
    };
    loadExternalLibs();

    // If no key, show settings immediately
    if (!localStorage.getItem('gemini_user_api_key')) {
      setShowSettings(true);
    }
  }, []);

  // --- Key Handling ---
  const saveApiKey = (key: string) => {
    setUserApiKey(key);
    localStorage.setItem('gemini_user_api_key', key);
    setShowSettings(false);
  };

  // --- File Handling ---
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const sortedFiles = Array.from(e.target.files).sort((a, b) => {
        const pathA = a.webkitRelativePath || a.name;
        const pathB = b.webkitRelativePath || b.name;
        return pathA.localeCompare(pathB);
      });

      const newItems: WorkItem[] = sortedFiles
        .filter(file => file.type.startsWith('image/'))
        .map(file => ({
          id: Math.random().toString(36).substr(2, 9),
          file,
          relativePath: file.webkitRelativePath || file.name,
          previewUrl: URL.createObjectURL(file),
          resultUrl: null,
          status: 'pending',
          type: 'unknown'
        }));
      
      setItems(prev => [...prev, ...newItems]);
      setActiveTab('upload');
    }
  };

  const removeCreateItem = (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      newSet.delete(id);
      return newSet;
    });
  };

  const clearAll = () => {
    setItems([]);
    setSelectedIds(new Set());
    setIsProcessing(false);
  };

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const selectAllCompleted = () => {
    const completedIds = items.filter(i => (i.status === 'completed' || i.status === 'fallback') && i.resultUrl).map(i => i.id);
    if (selectedIds.size === completedIds.length && completedIds.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(completedIds));
    }
  };

  // --- Download Logic ---
  const downloadSelectedAsZip = async () => {
    // @ts-ignore
    if (!window.JSZip) { alert("组件初始化中..."); return; }
    setIsZipping(true);
    try {
      // @ts-ignore
      const zip = new window.JSZip();
      let count = 0;
      items.forEach(item => {
        if (selectedIds.has(item.id) && item.resultUrl) {
          count++;
          const base64Data = item.resultUrl.split(',')[1];
          const originalPath = item.relativePath;
          const lastDotIndex = originalPath.lastIndexOf('.');
          const basePath = lastDotIndex !== -1 ? originalPath.substring(0, lastDotIndex) : originalPath;
          const suffix = item.status === 'fallback' ? '_DETAIL' : '_PROCESSED';
          const fileName = `${basePath}${suffix}.png`;
          zip.file(fileName, base64Data, {base64: true});
        }
      });
      if (count === 0) { setIsZipping(false); return; }
      const content = await zip.generateAsync({type: "blob"});
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = "batch_processed_images.zip";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error("Zip failed", error);
      alert("打包失败");
    } finally {
      setIsZipping(false);
    }
  };

  // --- Processing Logic ---
  const processBatch = async () => {
    if (!userApiKey) {
      setShowSettings(true);
      return;
    }
    if (items.length === 0) return;
    setIsProcessing(true);
    setActiveTab('results');

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.status === 'completed' || item.status === 'fallback') continue; 
      updateItemStatus(item.id, 'processing');
      try {
        await generateImageWithFallback(item.file);
      } catch (error: any) {
        updateItemStatus(item.id, 'error', undefined, error.message);
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    setIsProcessing(false);
  };

  const handleRegenerate = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!userApiKey) { setShowSettings(true); return; }
    const itemIndex = items.findIndex(i => i.id === id);
    if (itemIndex === -1) return;
    updateItemStatus(id, 'processing', undefined, undefined);
    try {
        await generateImageWithFallback(items[itemIndex].file, id);
    } catch (error: any) {
        updateItemStatus(id, 'error', undefined, error.message);
    }
  };

  const updateItemStatus = (id: string, status: WorkItem['status'], resultUrl?: string, errorMsg?: string) => {
    setItems(prev => prev.map(item => {
      if (item.id === id) {
        return { ...item, status, resultUrl: resultUrl !== undefined ? resultUrl : item.resultUrl, errorMsg };
      }
      return item;
    }));
  };

  // --- API ---
  const generateImageWithFallback = async (file: File, itemId?: string) => {
    const targetId = itemId || items.find(i => i.file === file)?.id;
    if (!targetId) return;

    try {
      const prompt = createModelPrompt(modelPrompt, bgPrompt, consistencyLock.current);
      const result = await callGeminiApi(file, prompt);
      updateItemStatus(targetId, 'completed', result);
    } catch (error: any) {
      if (isSafetyError(error)) {
        try {
          const fallbackPrompt = createFallbackPrompt(bgPrompt);
          const fallbackResult = await callGeminiApi(file, fallbackPrompt);
          updateItemStatus(targetId, 'fallback', fallbackResult); 
        } catch (fallbackError: any) {
           throw new Error("双重失败：无法生成（安全拦截）");
        }
      } else {
        throw error;
      }
    }
  };

  const isSafetyError = (error: any) => {
    const msg = error.message?.toLowerCase() || "";
    return msg.includes("safety") || msg.includes("blocked") || msg.includes("拦截") || msg.includes("sensitive");
  };

  const createModelPrompt = (modelDesc: string, bgDesc: string, consistency: string) => `
    Context: Professional E-commerce Clothing Catalog. Product: Thermal Innerwear. Rating: G.
    Task: Product Styling Update.
    CRITICAL RULES: 1. MAINTAIN ASPECT RATIO. 2. NO NEW TEXT. 3. PRESERVE ORIGINAL TEXT.
    Subject:
    CASE 1: HUMAN MODEL: Completely REPLACE face with: ${modelDesc}. Identity Consistency: ${consistency}. Keep clothing exactly as is.
    CASE 2: NO HUMAN MODEL: Keep product unchanged.
    Background: ${bgDesc}. Style: Commercial Studio.
  `;

  const createFallbackPrompt = (bgDesc: string) => `
    Task: Product Texture Detail Shot.
    ACTION: REMOVE MODEL COMPLETELY. Close-up of CLOTHING FABRIC only.
    Background: ${bgDesc}.
  `;

  const callGeminiApi = async (file: File, promptText: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const base64String = reader.result as string;
          const base64Data = base64String.split(',')[1];
          const mimeType = base64String.split(';')[0].split(':')[1];

          const payload = {
            contents: [{ parts: [{ text: promptText }, { inlineData: { mimeType: mimeType, data: base64Data } }] }],
            safetySettings: [
              { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
            ]
          };

          const response = await fetchWithBackoff(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent?key=${userApiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            }
          );

          const data = await response.json();
          if (data.error) throw new Error(data.error.message || "API Error");

          const candidate = data.candidates?.[0];
          if (!candidate) throw new Error("No candidates returned.");

          if (candidate.finishReason !== "STOP") {
             if (candidate.finishReason === "SAFETY" || candidate.finishReason === "IMAGE_SAFETY") throw new Error("SAFETY_BLOCK");
             throw new Error(`Status: ${candidate.finishReason}`);
          }

          const generatedPart = candidate.content?.parts?.find((p: any) => p.inlineData);
          if (generatedPart?.inlineData) {
            resolve(`data:${generatedPart.inlineData.mimeType};base64,${generatedPart.inlineData.data}`);
          } else {
            throw new Error("No image returned.");
          }
        } catch (err) {
          reject(err);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  async function fetchWithBackoff(url: string, options: any, retries = 3, delay = 1000): Promise<Response> {
    try {
      const response = await fetch(url, options);
      if (!response.ok && response.status === 429 && retries > 0) throw new Error("Too Many Requests");
      return response;
    } catch (err) {
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
        return fetchWithBackoff(url, options, retries - 1, delay * 2);
      }
      throw err;
    }
  }

  // --- Components ---
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans selection:bg-indigo-100 p-4 md:p-8">
      
      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-2 mb-4 text-indigo-600">
              <Key className="w-6 h-6" />
              <h2 className="text-xl font-bold">配置 API Key</h2>
            </div>
            <p className="text-sm text-slate-500 mb-4 leading-relaxed">
              为了将此工具部署为网页并保障安全，请在此输入您的 Google Gemini API Key。<br/>
              <span className="text-xs bg-slate-100 px-1 rounded">Key 将仅保存在您的浏览器本地缓存中，不会上传到任何服务器。</span>
            </p>
            <input 
              type="password" 
              placeholder="粘贴您的 API Key (AIzaSy...)" 
              className="w-full p-3 border border-slate-300 rounded-lg mb-4 focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-sm"
              defaultValue={userApiKey}
              id="apiKeyInput"
            />
            <div className="flex justify-end gap-2">
              {userApiKey && (
                <button onClick={() => setShowSettings(false)} className="px-4 py-2 text-slate-500 hover:text-slate-700 text-sm">关闭</button>
              )}
              <button 
                onClick={() => {
                  const input = document.getElementById('apiKeyInput') as HTMLInputElement;
                  if (input.value) saveApiKey(input.value);
                }}
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
              >
                保存并开始
              </button>
            </div>
            <div className="mt-4 pt-4 border-t border-slate-100 text-center">
              <a href="https://aistudio.google.com/app/apikey" target="_blank" className="text-xs text-indigo-500 hover:underline">没有 Key? 点击免费获取</a>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto space-y-6">
        <header className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-200 pb-6 gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <Wand2 className="w-8 h-8 text-indigo-600" />
              AI 批量美工工作台 (Web v6.0)
            </h1>
            <p className="text-slate-500 text-sm">目录递归 / ZIP打包 / 网页通用版</p>
          </div>
          <div className="flex gap-2 items-center">
             <button onClick={() => setShowSettings(true)} className="p-2 text-slate-400 hover:text-indigo-600 transition-colors" title="设置 API Key">
               <Settings className="w-5 h-5" />
             </button>
             <div className="h-6 w-px bg-slate-200 mx-1"></div>
             <button onClick={() => setActiveTab('upload')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'upload' ? 'bg-white text-indigo-600 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:bg-white/50'}`}>1. 上传素材</button>
             <button onClick={() => setActiveTab('results')} disabled={items.length === 0} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'results' ? 'bg-white text-indigo-600 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:bg-white/50'}`}>2. 处理结果</button>
          </div>
        </header>

        {/* Config Bar */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-6 items-start md:items-center">
           <div className="flex-1 space-y-2 w-full">
              <label className="text-xs font-bold text-slate-500 uppercase">统一模特设定 (Korean Identity)</label>
              <input type="text" value={modelPrompt} onChange={(e) => setModelPrompt(e.target.value)} className="w-full text-sm p-2 border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:border-indigo-500" />
           </div>
           <div className="flex-1 space-y-2 w-full">
              <label className="text-xs font-bold text-slate-500 uppercase">统一背景风格</label>
              <input type="text" value={bgPrompt} onChange={(e) => setBgPrompt(e.target.value)} className="w-full text-sm p-2 border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:border-indigo-500" />
           </div>
           <button onClick={processBatch} disabled={isProcessing || items.length === 0} className={`h-10 px-6 rounded-lg font-bold text-sm shadow-md flex items-center gap-2 whitespace-nowrap transition-all ${isProcessing || items.length === 0 ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}>
             {isProcessing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
             {isProcessing ? '处理中...' : '开始批量执行'}
           </button>
        </div>

        {/* Main Area */}
        <div className="min-h-[400px]">
           {activeTab === 'upload' ? (
             <div className="space-y-6 animate-in fade-in">
               <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 <div className="relative group cursor-pointer border-3 border-dashed border-slate-300 rounded-2xl h-48 flex flex-col items-center justify-center bg-white hover:border-indigo-400 hover:bg-indigo-50/30 transition-all" onClick={() => fileInputRef.current?.click()}>
                   <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/*" multiple className="hidden" />
                   <div className="text-center p-6"><div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-2"><FilePlus className="w-6 h-6"/></div><p className="font-bold text-slate-700">选择图片文件</p><p className="text-xs text-slate-400">Ctrl/Shift 多选</p></div>
                 </div>
                 <div className="relative group cursor-pointer border-3 border-dashed border-slate-300 rounded-2xl h-48 flex flex-col items-center justify-center bg-white hover:border-indigo-400 hover:bg-indigo-50/30 transition-all" onClick={() => folderInputRef.current?.click()}>
                   <input type="file" ref={folderInputRef} onChange={handleFileUpload} webkitdirectory="" directory="" multiple className="hidden" />
                   <div className="text-center p-6"><div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-2"><FolderInput className="w-6 h-6"/></div><p className="font-bold text-slate-700">上传整个文件夹</p><p className="text-xs text-slate-400">自动识别子目录</p></div>
                 </div>
               </div>
               {items.length > 0 && (
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                    <div className="flex justify-between items-center mb-4"><h3 className="font-bold text-slate-700 flex items-center gap-2"><Layers className="w-5 h-5 text-indigo-500"/>待处理 ({items.length})</h3><button onClick={clearAll} className="text-xs text-red-500 hover:text-red-700 font-medium">清空列表</button></div>
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                      {items.map(item => (
                        <div key={item.id} className="relative group aspect-[3/4] rounded-lg overflow-hidden border border-slate-100 bg-slate-50">
                          <img src={item.previewUrl} className="w-full h-full object-cover" />
                          <button onClick={() => removeCreateItem(item.id)} className="absolute top-1 right-1 bg-black/50 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 hover:bg-red-500"><X className="w-3 h-3"/></button>
                          <div className="absolute bottom-0 inset-x-0 bg-black/60 p-1"><p className="text-white text-[10px] truncate px-1" title={item.relativePath}>{item.relativePath}</p></div>
                        </div>
                      ))}
                    </div>
                  </div>
               )}
             </div>
           ) : (
             <div className="space-y-6 animate-in slide-in-from-right-8">
               <div className="flex flex-col md:flex-row justify-between gap-4">
                  <h2 className="text-xl font-bold text-slate-800">输出结果 <span className="text-sm font-normal text-slate-500">({items.filter(i=>(i.status==='completed'||i.status==='fallback')&&i.resultUrl).length} / {items.length})</span></h2>
                  <div className="flex gap-2">
                    {isProcessing ? <div className="flex items-center gap-2 text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-full text-sm animate-pulse"><RefreshCw className="w-4 h-4 animate-spin"/> 处理中...</div> : (
                      <>
                        <button onClick={selectAllCompleted} className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg flex items-center gap-2">{selectedIds.size>0 ? <CheckSquare className="w-4 h-4"/>:<Square className="w-4 h-4"/>} 全选</button>
                        <button onClick={downloadSelectedAsZip} disabled={selectedIds.size===0||isZipping} className={`px-4 py-1.5 text-sm font-bold rounded-lg flex items-center gap-2 ${selectedIds.size>0&&!isZipping?'bg-indigo-600 text-white hover:bg-indigo-700':'bg-slate-100 text-slate-400 cursor-not-allowed'}`}>{isZipping?<RefreshCw className="w-4 h-4 animate-spin"/>:<Archive className="w-4 h-4"/>} {isZipping?'打包中...':`打包下载 (${selectedIds.size})`}</button>
                      </>
                    )}
                  </div>
               </div>
               <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {items.map(item => {
                    const isDone = (item.status === 'completed' || item.status === 'fallback') && item.resultUrl;
                    const isSelected = selectedIds.has(item.id);
                    return (
                      <div key={item.id} onClick={() => isDone && toggleSelection(item.id)} className={`bg-white rounded-xl border overflow-hidden flex flex-col transition-all ${isSelected?'ring-2 ring-indigo-500 border-indigo-500':'border-slate-200'} ${item.status==='fallback'?'bg-amber-50/50':''}`}>
                        <div className="p-3 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                          <div className="flex items-center gap-2 overflow-hidden flex-1">
                             {isDone && <div className={`w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 ${isSelected?'bg-indigo-600 border-indigo-600':'bg-white border-slate-300'}`}>{isSelected&&<CheckSquare className="w-3.5 h-3.5 text-white"/>}</div>}
                             <span className="text-xs font-mono text-slate-500 truncate" title={item.relativePath}>{item.relativePath}</span>
                          </div>
                          <div className="flex-shrink-0 ml-2">
                            {item.status==='fallback' ? <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700 flex items-center gap-1"><ShieldAlert className="w-3 h-3"/>细节图</span> : <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${item.status==='completed'?'bg-green-100 text-green-700':item.status==='error'?'bg-red-100 text-red-700':item.status==='processing'?'bg-indigo-100 text-indigo-700':'bg-slate-100 text-slate-500'}`}>{item.status==='completed'?'完成':item.status==='error'?'失败':item.status==='processing'?'渲染...':'等待'}</span>}
                          </div>
                        </div>
                        <div className="flex-1 bg-slate-100 min-h-[300px] flex items-center justify-center p-2 relative cursor-pointer">
                          <div className="absolute inset-0 opacity-5" style={{backgroundImage: 'radial-gradient(#444 1px, transparent 1px)', backgroundSize: '20px 20px'}}></div>
                          {isDone ? <img src={item.resultUrl!} className="max-w-full max-h-[500px] object-contain shadow-sm" /> : (
                            <>
                              <img src={item.previewUrl} className={`max-w-full max-h-[500px] object-contain transition-opacity ${item.status==='processing'?'opacity-50 blur-sm':''}`} />
                              {item.status==='processing' && <div className="absolute inset-0 flex items-center justify-center z-10"><div className="bg-white/90 px-6 py-4 rounded-xl shadow-lg flex flex-col items-center"><RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mb-2"/><span className="text-sm font-bold text-slate-700">AI 重绘中...</span></div></div>}
                              {item.status==='error' && <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 text-red-500 p-4 text-center z-10"><AlertCircle className="w-8 h-8 mb-2"/><p className="text-xs">{item.errorMsg}</p></div>}
                            </>
                          )}
                        </div>
                        <div className="p-3 border-t border-slate-100 flex gap-2" onClick={e=>e.stopPropagation()}>
                           {isDone && <><button onClick={e=>handleRegenerate(item.id,e)} className="px-3 py-2 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-lg"><RotateCcw className="w-4 h-4"/></button><button onClick={()=>{const link=document.createElement('a');link.href=item.resultUrl!;link.download="single_download.png";link.click();}} className="flex-1 flex items-center justify-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm py-2 rounded-lg"><Download className="w-4 h-4"/> 下载</button></>}
                        </div>
                      </div>
                    );
                  })}
               </div>
             </div>
           )}
        </div>
      </div>
    </div>
  );
}