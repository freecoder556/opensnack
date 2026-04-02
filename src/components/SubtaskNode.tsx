import React, { useState } from 'react';
import { CheckCircle2, Circle, Plus, X } from 'lucide-react';
import { twMerge } from 'tailwind-merge';
import { clsx, type ClassValue } from 'clsx';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
  subtasks?: Subtask[];
}

interface SubtaskNodeProps {
  todoId: string;
  subtask: Subtask;
  level?: number;
  onToggle: (todoId: string, subtaskId: string) => void;
  onDelete: (todoId: string, subtaskId: string) => void;
  onAdd: (todoId: string, parentId: string | null, title: string) => void;
}

export const SubtaskNode: React.FC<SubtaskNodeProps> = ({ todoId, subtask, level = 0, onToggle, onDelete, onAdd }) => {
  const [isAdding, setIsAdding] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 group/sub">
        <button 
          onClick={() => onToggle(todoId, subtask.id)}
          className={cn(
            "transition-colors",
            subtask.completed ? "text-blue-400" : "text-slate-300 hover:text-blue-300"
          )}
        >
          {subtask.completed ? <CheckCircle2 size={16} /> : <Circle size={16} />}
        </button>
        <span className={cn(
          "text-sm font-medium flex-1",
          subtask.completed ? "text-slate-400 line-through" : "text-slate-600"
        )}>
          {subtask.title}
        </span>
        
        <button
          onClick={() => setIsAdding(!isAdding)}
          className="opacity-0 group-hover/sub:opacity-100 text-slate-300 hover:text-blue-400 transition-all"
          title="Add nested subtask"
        >
          <Plus size={14} />
        </button>

        <button 
          onClick={() => onDelete(todoId, subtask.id)}
          className="opacity-0 group-hover/sub:opacity-100 text-slate-300 hover:text-red-400 transition-all"
          title="Delete subtask"
        >
          <X size={14} />
        </button>
      </div>
      
      {/* Render nested subtasks */}
      {(subtask.subtasks && subtask.subtasks.length > 0) && (
        <div className="pl-6 space-y-2 border-l-2 border-slate-100 ml-2">
          {subtask.subtasks.map(child => (
            <SubtaskNode 
              key={child.id} 
              todoId={todoId} 
              subtask={child} 
              level={level + 1} 
              onToggle={onToggle}
              onDelete={onDelete}
              onAdd={onAdd}
            />
          ))}
        </div>
      )}
      
      {/* Add nested subtask form */}
      {isAdding && (
        <div className="pl-6 ml-2 mt-2">
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              const input = e.currentTarget.elements.namedItem('subtask') as HTMLInputElement;
              if (input.value.trim()) {
                onAdd(todoId, subtask.id, input.value);
                input.value = '';
                setIsAdding(false);
              }
            }}
            className="flex items-center gap-3"
          >
            <Plus size={12} className="text-slate-300" />
            <input 
              name="subtask"
              type="text"
              autoFocus
              placeholder="Add nested subtask..."
              className="bg-transparent border-none outline-none text-xs font-medium text-slate-400 placeholder:text-slate-300 w-full"
              onBlur={(e) => {
                if (!e.target.value.trim()) {
                  setIsAdding(false);
                }
              }}
            />
          </form>
        </div>
      )}
    </div>
  );
};
