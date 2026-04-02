import React, { useState, useEffect, useMemo } from 'react';
import { 
  Plus, 
  Calendar as CalendarIcon, 
  CheckCircle2, 
  Circle, 
  Trash2, 
  Sparkles, 
  ChevronLeft, 
  ChevronRight,
  Clock,
  List as ListIcon,
  Tag,
  Folder,
  Edit2,
  X,
  GripVertical
} from 'lucide-react';
import { 
  format, 
  addMonths, 
  subMonths, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  isSameMonth, 
  isToday,
  addDays, 
  parseISO,
  isValid
} from 'date-fns';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { GoogleGenAI, Type } from "@google/genai";
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { SubtaskNode, type Subtask } from './components/SubtaskNode';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function safeParseISO(dateString: string | undefined | null, fallback: Date = new Date()): Date {
  if (!dateString) return fallback;
  try {
    const parsed = parseISO(dateString);
    return isValid(parsed) ? parsed : fallback;
  } catch (e) {
    return fallback;
  }
}

// --- Types ---

interface Todo {
  id: string;
  title: string;
  startTime: string; // ISO string
  deadline: string; // ISO string
  completed: boolean;
  priority: 'low' | 'medium' | 'high';
  createdAt: string;
  tags: string[];
  group: string;
  subtasks: Subtask[];
}

// --- AI Service ---

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

async function parseTaskWithAI(input: string): Promise<Partial<Todo>> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Parse this todo task: "${input}". 
      Current date is ${new Date().toISOString()}.
      Return a JSON object with:
      - title: string (the task name)
      - startTime: string (ISO format, if mentioned, otherwise null)
      - deadline: string (ISO format, if mentioned, otherwise null)
      - priority: "low" | "medium" | "high" (infer from urgency)
      - tags: string[] (infer relevant tags)
      - group: string (infer a category like "Work", "Personal", "Health")`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            startTime: { type: Type.STRING },
            deadline: { type: Type.STRING },
            priority: { type: Type.STRING, enum: ["low", "medium", "high"] },
            tags: { type: Type.ARRAY, items: { type: Type.STRING } },
            group: { type: Type.STRING }
          },
          required: ["title", "priority"]
        }
      }
    });

    const result = JSON.parse(response.text || '{}');
    return result;
  } catch (error) {
    console.error("AI Parsing failed:", error);
    return { title: input, priority: 'medium' };
  }
}

// --- Components ---

const GlassCard = ({ children, className }: { children: React.ReactNode, className?: string }) => (
  <div className={cn("glass rounded-3xl p-6", className)}>
    {children}
  </div>
);

const Modal = ({ isOpen, onClose, title, children }: { isOpen: boolean, onClose: () => void, title: string, children: React.ReactNode }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/20 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="glass-dark w-full max-w-lg rounded-[2.5rem] overflow-hidden"
      >
        <div className="flex items-center justify-between p-8 border-b border-white/20">
          <h2 className="text-2xl font-bold text-slate-800">{title}</h2>
          <button onClick={onClose} className="p-2 hover:bg-white/50 rounded-full transition-colors">
            <X size={24} className="text-slate-500" />
          </button>
        </div>
        <div className="p-8 max-h-[70vh] overflow-y-auto">
          {children}
        </div>
      </motion.div>
    </div>
  );
};

export default function App() {
  const [todos, setTodos] = useState<Todo[]>(() => {
    const saved = localStorage.getItem('lumina_todos_v2');
    if (!saved) return [];
    try {
      const parsed = JSON.parse(saved);
      return parsed.map((t: any) => ({
        ...t,
        startTime: typeof t.startTime === 'string' ? t.startTime : new Date(t.startTime || Date.now()).toISOString(),
        deadline: typeof t.deadline === 'string' ? t.deadline : new Date(t.deadline || Date.now() + 86400000).toISOString(),
        createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date(t.createdAt || Date.now()).toISOString(),
        tags: Array.isArray(t.tags) ? t.tags : [],
        subtasks: Array.isArray(t.subtasks) ? t.subtasks : [],
        group: t.group || 'General',
        priority: t.priority || 'medium',
        title: t.title || 'Untitled',
      }));
    } catch (e) {
      return [];
    }
  });
  const [input, setInput] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  
  // Editing state
  const [selectedGroup, setSelectedGroup] = useState<string>('All');
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  const [isManualAddOpen, setIsManualAddOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem('lumina_todos_v2', JSON.stringify(todos));
  }, [todos]);

  const addTodo = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim()) return;

    setIsAiLoading(true);
    const parsed = await parseTaskWithAI(input);
    setIsAiLoading(false);

    const newTodo: Todo = {
      id: crypto.randomUUID(),
      title: parsed.title || input,
      startTime: typeof parsed.startTime === 'string' ? parsed.startTime : new Date().toISOString(),
      deadline: typeof parsed.deadline === 'string' ? parsed.deadline : new Date(Date.now() + 86400000).toISOString(),
      completed: false,
      priority: (parsed.priority as any) || 'medium',
      createdAt: new Date().toISOString(),
      tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
      group: typeof parsed.group === 'string' ? parsed.group : 'General',
      subtasks: []
    };

    setTodos(prev => [newTodo, ...prev]);
    setInput('');
  };

  const handleManualAdd = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const now = new Date().toISOString();
    const title = formData.get('title')?.toString() || 'Untitled Task';
    const tagsValue = formData.get('tags');
    const tags = (tagsValue !== null && tagsValue !== undefined) ? tagsValue.toString() : '';
    console.log('handleManualAdd tags:', tags);
    const group = formData.get('group')?.toString() || 'General';
    const priority = (formData.get('priority')?.toString() as any) || 'medium';

    const newTodo: Todo = {
      id: crypto.randomUUID(),
      title,
      startTime: formData.get('startTime') ? safeParseISO(formData.get('startTime') as string).toISOString() : now,
      deadline: formData.get('deadline') ? safeParseISO(formData.get('deadline') as string).toISOString() : new Date(Date.now() + 86400000).toISOString(),
      completed: false,
      priority,
      createdAt: now,
      tags: (tags || '').split(',').map(t => t.trim()).filter(Boolean),
      group,
      subtasks: []
    };
    setTodos(prev => [newTodo, ...prev]);
    setIsManualAddOpen(false);
  };

  const handleUpdateTodo = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingTodo) return;
    const formData = new FormData(e.currentTarget);
    const title = formData.get('title')?.toString() || editingTodo.title;
    const tagsValue = formData.get('tags');
    const tags = (tagsValue !== null && tagsValue !== undefined) ? tagsValue.toString() : '';
    console.log('handleUpdateTodo tags:', tags);
    const group = formData.get('group')?.toString() || editingTodo.group;
    const priority = (formData.get('priority')?.toString() as any) || editingTodo.priority;

    const updated: Todo = {
      ...editingTodo,
      title,
      startTime: formData.get('startTime') ? safeParseISO(formData.get('startTime') as string).toISOString() : editingTodo.startTime,
      deadline: formData.get('deadline') ? safeParseISO(formData.get('deadline') as string).toISOString() : editingTodo.deadline,
      priority,
      group,
      tags: (tags || '').split(',').map(t => t.trim()).filter(Boolean),
    };
    setTodos(prev => prev.map(t => t.id === updated.id ? updated : t));
    setEditingTodo(null);
  };

  const filteredTodos = useMemo(() => {
    if (selectedGroup === 'All') return todos;
    return todos.filter(t => t.group === selectedGroup);
  }, [todos, selectedGroup]);

  const groups = useMemo(() => {
    const g = new Set<string>(['All']);
    todos.forEach(t => {
      if (t.group) g.add(t.group);
    });
    return Array.from(g);
  }, [todos]);

  const toggleTodo = (id: string) => {
    setTodos(prev => prev.map(t => t.id === id ? { ...t, completed: !t.completed } : t));
  };

  const deleteTodo = (id: string) => {
    setTodos(prev => prev.filter(t => t.id !== id));
  };

  const toggleSubtaskInTree = (subtasks: Subtask[], targetId: string): Subtask[] => {
    return subtasks.map(sub => {
      if (sub.id === targetId) {
        return { ...sub, completed: !sub.completed };
      }
      if (sub.subtasks) {
        return { ...sub, subtasks: toggleSubtaskInTree(sub.subtasks, targetId) };
      }
      return sub;
    });
  };

  const deleteSubtaskInTree = (subtasks: Subtask[], targetId: string): Subtask[] => {
    return subtasks.filter(sub => sub.id !== targetId).map(sub => {
      if (sub.subtasks) {
        return { ...sub, subtasks: deleteSubtaskInTree(sub.subtasks, targetId) };
      }
      return sub;
    });
  };

  const addSubtaskInTree = (subtasks: Subtask[], targetParentId: string, newSubtask: Subtask): Subtask[] => {
    return subtasks.map(sub => {
      if (sub.id === targetParentId) {
        return { ...sub, subtasks: [...(sub.subtasks || []), newSubtask] };
      }
      if (sub.subtasks) {
        return { ...sub, subtasks: addSubtaskInTree(sub.subtasks, targetParentId, newSubtask) };
      }
      return sub;
    });
  };

  const toggleSubtask = (todoId: string, subtaskId: string) => {
    setTodos(prev => prev.map(t => {
      if (t.id === todoId) {
        return { ...t, subtasks: toggleSubtaskInTree(t.subtasks || [], subtaskId) };
      }
      return t;
    }));
  };

  const addSubtask = (todoId: string, parentSubtaskId: string | null, title: string) => {
    if (!title.trim()) return;
    const newSubtask: Subtask = { id: crypto.randomUUID(), title, completed: false, subtasks: [] };
    
    setTodos(prev => prev.map(t => {
      if (t.id === todoId) {
        if (parentSubtaskId === null) {
          return { ...t, subtasks: [...(t.subtasks || []), newSubtask] };
        } else {
          return { ...t, subtasks: addSubtaskInTree(t.subtasks || [], parentSubtaskId, newSubtask) };
        }
      }
      return t;
    }));
  };

  const deleteSubtask = (todoId: string, subtaskId: string) => {
    setTodos(prev => prev.map(t => {
      if (t.id === todoId) {
        return { ...t, subtasks: deleteSubtaskInTree(t.subtasks || [], subtaskId) };
      }
      return t;
    }));
  };

  const countSubtasks = (subtasks: Subtask[]): { total: number, completed: number } => {
    return subtasks.reduce((acc, sub) => {
      const children = countSubtasks(sub.subtasks || []);
      return {
        total: acc.total + 1 + children.total,
        completed: acc.completed + (sub.completed ? 1 : 0) + children.completed
      };
    }, { total: 0, completed: 0 });
  };

  // --- Calendar Logic ---

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart);
    const endDate = endOfWeek(monthEnd);

    const days = [];
    let day = startDate;

    while (day <= endDate) {
      days.push(day);
      day = addDays(day, 1);
    }
    return days;
  }, [currentMonth]);

  const todosByDay = useMemo(() => {
    const priorityWeight = { high: 3, medium: 2, low: 1 };
    const map: Record<string, Todo[]> = {};
    
    // We only care about days in the current calendar view range
    calendarDays.forEach(day => {
      const dateKey = format(day, 'yyyy-MM-dd');
      const dayStart = new Date(day.setHours(0, 0, 0, 0));
      const dayEnd = new Date(day.setHours(23, 59, 59, 999));

      const dayTodos = todos.filter(todo => {
        const todoStart = safeParseISO(todo.startTime);
        const todoEnd = safeParseISO(todo.deadline);
        // Task spans this day if it starts before day ends AND ends after day starts
        return todoStart <= dayEnd && todoEnd >= dayStart;
      }).sort((a, b) => {
        const weightA = priorityWeight[a.priority];
        const weightB = priorityWeight[b.priority];
        if (weightA !== weightB) return weightB - weightA;
        return a.createdAt.localeCompare(b.createdAt);
      });

      if (dayTodos.length > 0) {
        map[dateKey] = dayTodos;
      }
    });
    return map;
  }, [todos, calendarDays]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-12 md:py-20">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 mb-2">Lumina AI</h1>
          <p className="text-slate-500 font-medium">Organize your life with liquid clarity.</p>
        </div>
        
        <div className="flex items-center gap-2 glass p-1.5 rounded-2xl self-start">
          <button 
            onClick={() => setView('list')}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-xl transition-all duration-300",
              view === 'list' ? "bg-white shadow-sm text-blue-600" : "text-slate-500 hover:text-slate-700"
            )}
          >
            <ListIcon size={18} />
            <span className="text-sm font-semibold">List</span>
          </button>
          <button 
            onClick={() => setView('calendar')}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-xl transition-all duration-300",
              view === 'calendar' ? "bg-white shadow-sm text-blue-600" : "text-slate-500 hover:text-slate-700"
            )}
          >
            <CalendarIcon size={18} />
            <span className="text-sm font-semibold">Calendar</span>
          </button>
        </div>
      </header>

      {/* Input Section */}
      <section className="mb-12 flex gap-3">
        <form onSubmit={addTodo} className="relative group flex-1">
          <div className="absolute inset-y-0 left-5 flex items-center pointer-events-none">
            {isAiLoading ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
              >
                <Sparkles size={20} className="text-blue-400" />
              </motion.div>
            ) : (
              <Sparkles size={20} className="text-blue-400 group-focus-within:text-blue-500 transition-colors" />
            )}
          </div>
          <input 
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Try 'Meeting with team tomorrow at 2pm'..."
            className="w-full glass-input rounded-3xl py-5 pl-14 pr-20 text-lg font-medium placeholder:text-slate-400"
          />
          <button 
            type="submit"
            disabled={!input.trim() || isAiLoading}
            className="absolute right-3 top-1/2 -translate-y-1/2 bg-blue-500 hover:bg-blue-600 disabled:bg-slate-200 text-white p-3 rounded-2xl transition-all shadow-lg shadow-blue-500/20 liquid-button"
          >
            <Plus size={24} />
          </button>
        </form>
        <button 
          onClick={() => setIsManualAddOpen(true)}
          className="glass p-5 rounded-3xl text-slate-500 hover:text-blue-500 transition-colors"
          title="Manual Add"
        >
          <Edit2 size={24} />
        </button>
      </section>

      {/* Main Content */}
      <AnimatePresence mode="wait">
        {view === 'list' ? (
          <div className="space-y-6">
            {/* Group Filter */}
            {groups.length > 1 && (
              <div className="flex items-center gap-2 overflow-x-auto pb-2 no-scrollbar">
                {groups.map(group => (
                  <button
                    key={group}
                    onClick={() => setSelectedGroup(group)}
                    className={cn(
                      "px-4 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all duration-300",
                      selectedGroup === group 
                        ? "bg-blue-500 text-white shadow-lg shadow-blue-500/20" 
                        : "bg-white/50 text-slate-500 hover:bg-white/80"
                    )}
                  >
                    {group}
                  </button>
                ))}
              </div>
            )}

            {filteredTodos.length === 0 ? (
              <div className="text-center py-20">
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-white/50 backdrop-blur-md border border-white/30 mb-6">
                  <Sparkles size={32} className="text-blue-300" />
                </div>
                <h3 className="text-xl font-semibold text-slate-700 mb-2">No tasks found</h3>
                <p className="text-slate-500">Try a different filter or add a new task.</p>
              </div>
            ) : (
              <Reorder.Group 
                axis="y" 
                values={filteredTodos} 
                onReorder={(newOrder) => {
                  const newTodos = [...todos];
                  filteredTodos.forEach((item, index) => {
                    const mainIndex = todos.findIndex(t => t.id === item.id);
                    if (mainIndex !== -1) {
                      newTodos[mainIndex] = newOrder[index];
                    }
                  });
                  setTodos(newTodos);
                }}
                className="space-y-4"
              >
                {filteredTodos.map(todo => {
                  const { total: totalSubtasks, completed: completedSubtasks } = countSubtasks(todo.subtasks || []);
                  const progress = totalSubtasks > 0 ? (completedSubtasks / totalSubtasks) * 100 : 0;

                  return (
                    <Reorder.Item
                      key={todo.id}
                      value={todo}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="list-none"
                    >
                      <GlassCard className={cn(
                        "flex flex-col gap-4 transition-all duration-300",
                        todo.completed && "opacity-60 grayscale-[0.5]"
                      )}>
                        <div className="flex items-center gap-4">
                          <div className="cursor-grab active:cursor-grabbing text-slate-300 p-1 hover:text-blue-400 transition-colors">
                            <GripVertical size={20} />
                          </div>
                          <button 
                            onClick={() => toggleTodo(todo.id)}
                            className="text-blue-500 hover:scale-110 transition-transform"
                          >
                            {todo.completed ? <CheckCircle2 size={26} /> : <Circle size={26} />}
                          </button>
                          
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <h3 className={cn(
                                "text-lg font-semibold truncate",
                                todo.completed && "line-through text-slate-400"
                              )}>
                                {todo.title}
                              </h3>
                              {todo.group && (
                                <span className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-blue-50 text-blue-500 text-[10px] font-bold">
                                  <Folder size={10} />
                                  {todo.group}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 mt-1">
                              <span className="flex items-center gap-1 text-xs font-bold text-slate-400">
                                <Clock size={12} />
                                {format(safeParseISO(todo.startTime), 'MMM d')} - {format(safeParseISO(todo.deadline), 'MMM d, h:mm a')}
                              </span>
                              <span className={cn(
                                "px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider",
                                todo.priority === 'high' ? "bg-red-100 text-red-500" :
                                todo.priority === 'medium' ? "bg-orange-100 text-orange-500" :
                                "bg-green-100 text-green-500"
                              )}>
                                {todo.priority}
                              </span>
                              {totalSubtasks > 0 && (
                                <div className="flex items-center gap-2 flex-1 max-w-[100px]">
                                  <div className="h-1 flex-1 bg-slate-100 rounded-full overflow-hidden">
                                    <div 
                                      className="h-full bg-blue-400 transition-all duration-500" 
                                      style={{ width: `${progress}%` }}
                                    />
                                  </div>
                                  <span className="text-[10px] font-bold text-slate-400 whitespace-nowrap">
                                    {completedSubtasks}/{totalSubtasks}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1">
                            <button 
                              onClick={() => setEditingTodo(todo)}
                              className="text-slate-300 hover:text-blue-400 transition-colors p-2"
                            >
                              <Edit2 size={18} />
                            </button>
                            <button 
                              onClick={() => deleteTodo(todo.id)}
                              className="text-slate-300 hover:text-red-400 transition-colors p-2"
                            >
                              <Trash2 size={18} />
                            </button>
                          </div>
                        </div>

                        {/* Tags */}
                        {todo.tags.length > 0 && (
                          <div className="flex flex-wrap gap-2 pl-12">
                            {todo.tags.map(tag => (
                              <span key={tag} className="flex items-center gap-1 text-[10px] font-bold text-blue-500 bg-blue-50 px-2 py-1 rounded-full">
                                <Tag size={10} />
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Subtasks */}
                        <div className="pl-12 space-y-2">
                          {todo.subtasks.map(sub => (
                            <SubtaskNode
                              key={sub.id}
                              todoId={todo.id}
                              subtask={sub}
                              onToggle={toggleSubtask}
                              onDelete={deleteSubtask}
                              onAdd={addSubtask}
                            />
                          ))}
                          <form 
                            onSubmit={(e) => {
                              e.preventDefault();
                              const input = e.currentTarget.elements.namedItem('subtask') as HTMLInputElement;
                              if (input.value.trim()) {
                                addSubtask(todo.id, null, input.value);
                                input.value = '';
                              }
                            }}
                            className="flex items-center gap-3 mt-2"
                          >
                            <Plus size={16} className="text-slate-300" />
                            <input 
                              name="subtask"
                              type="text"
                              placeholder="Add subtask..."
                              className="bg-transparent border-none outline-none text-sm font-medium text-slate-500 placeholder:text-slate-300 w-full"
                            />
                          </form>
                        </div>
                      </GlassCard>
                    </Reorder.Item>
                  );
                })}
              </Reorder.Group>
            )}
          </div>
        ) : (
          <motion.div
            key="calendar-view"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
          >
            <GlassCard className="p-0 overflow-hidden">
              {/* Calendar Header */}
              <div className="flex items-center justify-between p-6 border-b border-white/20">
                <h2 className="text-2xl font-bold text-slate-800">
                  {format(currentMonth, 'MMMM yyyy')}
                </h2>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                    className="p-2 hover:bg-white/50 rounded-xl transition-colors"
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <button 
                    onClick={() => setCurrentMonth(new Date())}
                    className="px-4 py-2 text-sm font-bold text-blue-600 hover:bg-white/50 rounded-xl transition-colors"
                  >
                    Today
                  </button>
                  <button 
                    onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                    className="p-2 hover:bg-white/50 rounded-xl transition-colors"
                  >
                    <ChevronRight size={20} />
                  </button>
                </div>
              </div>

              {/* Calendar Grid */}
              <div className="grid grid-cols-7 text-center border-b border-white/10">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                  <div key={day} className="py-4 text-xs font-black uppercase tracking-widest text-slate-400">
                    {day}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7">
                {calendarDays.map((day, i) => {
                  const dateKey = format(day, 'yyyy-MM-dd');
                  const dayTodos = todosByDay[dateKey] || [];
                  const isCurrentMonth = isSameMonth(day, currentMonth);
                  
                  return (
                    <div 
                      key={i}
                      className={cn(
                        "min-h-[120px] p-2 border-r border-b border-white/10 last:border-r-0 transition-colors",
                        !isCurrentMonth && "bg-slate-50/30 opacity-40",
                        isToday(day) && "bg-blue-50/30"
                      )}
                    >
                      <div className="flex justify-between items-center mb-2">
                        <span className={cn(
                          "text-sm font-bold w-7 h-7 flex items-center justify-center rounded-full",
                          isToday(day) ? "bg-blue-500 text-white" : "text-slate-600"
                        )}>
                          {format(day, 'd')}
                        </span>
                        {dayTodos.length > 0 && (
                          <span className="text-[10px] font-black text-blue-500 bg-blue-100 px-1.5 py-0.5 rounded-md">
                            {dayTodos.length}
                          </span>
                        )}
                      </div>
                      
                      <div className="space-y-1">
                        {dayTodos.slice(0, 3).map(todo => (
                          <button 
                            key={todo.id}
                            onClick={() => {
                              setEditingTodo(todo);
                            }}
                            className={cn(
                              "w-full text-left text-[10px] font-semibold px-2 py-1 rounded-lg truncate transition-transform active:scale-95",
                              todo.completed ? "bg-slate-100 text-slate-400 line-through" :
                              todo.priority === 'high' ? "bg-red-100 text-red-600" :
                              todo.priority === 'medium' ? "bg-orange-100 text-orange-600" :
                              "bg-green-100 text-green-600"
                            )}
                          >
                            {todo.title}
                          </button>
                        ))}
                        {dayTodos.length > 3 && (
                          <div className="text-[9px] font-bold text-slate-400 pl-1">
                            + {dayTodos.length - 3} more
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Manual Add Modal */}
      <Modal 
        isOpen={isManualAddOpen} 
        onClose={() => setIsManualAddOpen(false)} 
        title="Create New Task"
      >
        <form onSubmit={handleManualAdd} className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-500 uppercase tracking-wider">Title</label>
            <input name="title" required className="w-full glass-input rounded-2xl p-4 font-medium" placeholder="What needs to be done?" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-500 uppercase tracking-wider">Start Time</label>
              <input name="startTime" type="datetime-local" className="w-full glass-input rounded-2xl p-4 font-medium" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-500 uppercase tracking-wider">Deadline</label>
              <input name="deadline" type="datetime-local" className="w-full glass-input rounded-2xl p-4 font-medium" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-500 uppercase tracking-wider">Priority</label>
              <select name="priority" className="w-full glass-input rounded-2xl p-4 font-medium appearance-none">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-500 uppercase tracking-wider">Group</label>
              <input name="group" className="w-full glass-input rounded-2xl p-4 font-medium" placeholder="e.g. Work" />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-500 uppercase tracking-wider">Tags (comma separated)</label>
            <input name="tags" className="w-full glass-input rounded-2xl p-4 font-medium" placeholder="e.g. urgent, design" />
          </div>
          <button type="submit" className="w-full bg-blue-500 text-white font-bold py-5 rounded-3xl shadow-xl shadow-blue-500/20 liquid-button mt-4">
            Create Task
          </button>
        </form>
      </Modal>

      {/* Edit Modal */}
      <Modal 
        isOpen={!!editingTodo} 
        onClose={() => setEditingTodo(null)} 
        title="Edit Task"
      >
        {editingTodo && (
          <form onSubmit={handleUpdateTodo} className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-500 uppercase tracking-wider">Title</label>
              <input name="title" defaultValue={editingTodo.title} required className="w-full glass-input rounded-2xl p-4 font-medium" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-500 uppercase tracking-wider">Start Time</label>
                <input name="startTime" type="datetime-local" defaultValue={format(safeParseISO(editingTodo.startTime), "yyyy-MM-dd'T'HH:mm")} className="w-full glass-input rounded-2xl p-4 font-medium" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-500 uppercase tracking-wider">Deadline</label>
                <input name="deadline" type="datetime-local" defaultValue={format(safeParseISO(editingTodo.deadline), "yyyy-MM-dd'T'HH:mm")} className="w-full glass-input rounded-2xl p-4 font-medium" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-500 uppercase tracking-wider">Priority</label>
                <select name="priority" defaultValue={editingTodo.priority} className="w-full glass-input rounded-2xl p-4 font-medium appearance-none">
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-500 uppercase tracking-wider">Group</label>
                <input name="group" defaultValue={editingTodo.group} className="w-full glass-input rounded-2xl p-4 font-medium" />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-500 uppercase tracking-wider">Tags (comma separated)</label>
              <input name="tags" defaultValue={(editingTodo.tags || []).join(', ')} className="w-full glass-input rounded-2xl p-4 font-medium" />
            </div>
            <button type="submit" className="w-full bg-blue-500 text-white font-bold py-5 rounded-3xl shadow-xl shadow-blue-500/20 liquid-button mt-4">
              Save Changes
            </button>
          </form>
        )}
      </Modal>

      {/* Footer Stats */}
      <footer className="mt-12 flex items-center justify-between px-6 py-4 glass rounded-2xl">
        <div className="flex items-center gap-6">
          <div className="text-center">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total</p>
            <p className="text-xl font-bold text-slate-800">{todos.length}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Done</p>
            <p className="text-xl font-bold text-blue-500">{todos.filter(t => t.completed).length}</p>
          </div>
          {todos.some(t => t.completed) && (
            <button 
              onClick={() => setTodos(prev => prev.filter(t => !t.completed))}
              className="text-[10px] font-black uppercase tracking-widest text-red-400 hover:text-red-500 transition-colors ml-2"
            >
              Clear Done
            </button>
          )}
        </div>
        
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 italic">
          <Sparkles size={14} className="text-blue-400" />
          AI Powered Productivity
        </div>
      </footer>
    </div>
  );
}
