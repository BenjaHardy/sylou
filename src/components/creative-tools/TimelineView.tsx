import { useState, useCallback } from "react";
import { MiniTipTapEditor } from "@/components/creative-tools/MiniTipTapEditor";
import {
  DndContext,
  closestCenter,
  useSensor,
  useSensors,
  PointerSensor,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Clock, Trash2, GripVertical } from "lucide-react";
import { getCategoryColor, getCategoryLabel, stripHtml, type WorldBuildingCategory } from "@/lib/creative-tools-utils";
import type { Character } from "./CharactersDiagram";
import { CreativeAITextField } from "@/components/CreativeAITextField";

export interface TimelineEvent {
  id: string;
  title: string;
  description: string;
  date: string;
  order: number;
  character_ids: string[];
  category_id: string | null;
}

export interface TimelineData {
  events: TimelineEvent[];
}

interface Props {
  data: TimelineData;
  save: (d: TimelineData) => void;
  loading: boolean;
  worldCategories: WorldBuildingCategory[];
  characters: Character[];
}

/* ---------- Sortable event card ---------- */
function SortableEventCard({
  event,
  worldCategories,
  characters,
  onClick,
}: {
  event: TimelineEvent;
  worldCategories: WorldBuildingCategory[];
  characters: Character[];
  onClick: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: event.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const borderColor = getCategoryColor(worldCategories, event.category_id);

  return (
    <div ref={setNodeRef} style={style} className="flex items-start gap-3 group">
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        className="mt-3 cursor-grab opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </div>

      {/* Timeline dot and line */}
      <div className="flex flex-col items-center shrink-0">
        <div
          className="w-3 h-3 rounded-full border-2 mt-2"
          style={{ borderColor, backgroundColor: `${borderColor}33` }}
        />
        <div className="w-0.5 flex-1 bg-border min-h-[8px]" />
      </div>

      {/* Card */}
      <div
        className="flex-1 border rounded-lg px-3 py-1.5 mb-1.5 bg-card cursor-pointer hover:shadow-sm transition-shadow"
        style={{ borderLeftColor: borderColor, borderLeftWidth: 3 }}
        onClick={onClick}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            {event.date && (
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider shrink-0">
                {event.date}
              </span>
            )}
            {event.date && <span className="text-muted-foreground text-[10px]">·</span>}
            <span className="text-sm font-medium text-foreground truncate">{event.title || "Untitled event"}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {event.category_id && (
              <span className="text-[10px] font-medium" style={{ color: borderColor }}>
                {getCategoryLabel(worldCategories, event.category_id)}
              </span>
            )}
            {event.character_ids.map((cid) => {
              const char = characters.find((c) => c.id === cid);
              return (
                <Badge key={cid} variant="outline" className="text-[10px] px-1.5 py-0">
                  {char?.name ?? "(deleted)"}
                </Badge>
              );
            })}
          </div>
        </div>
        {event.description && (
          <p className="text-xs text-muted-foreground line-clamp-1">{stripHtml(event.description)}</p>
        )}
      </div>
    </div>
  );
}

/* ---------- Main component ---------- */
export function TimelineView({ data: rawData, save, loading, worldCategories, characters }: Props) {
  const data: TimelineData = { events: rawData.events ?? [] };
  const [editEvent, setEditEvent] = useState<TimelineEvent | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [filterCategories, setFilterCategories] = useState<string[]>([]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const updateData = useCallback(
    (updater: (d: TimelineData) => TimelineData) => {
      save(updater(data));
    },
    [data, save]
  );

  const handleAddEvent = () => {
    const maxOrder = data.events.reduce((max, e) => Math.max(max, e.order), -1);
    const newEvent: TimelineEvent = {
      id: crypto.randomUUID(),
      title: "New Event",
      description: "",
      date: "",
      order: maxOrder + 1,
      character_ids: [],
      category_id: null,
    };
    updateData((d) => ({ events: [...d.events, newEvent] }));
    setEditEvent(newEvent);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const sorted = [...data.events].sort((a, b) => a.order - b.order);
    const oldIndex = sorted.findIndex((e) => e.id === active.id);
    const newIndex = sorted.findIndex((e) => e.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(sorted, oldIndex, newIndex).map((e, i) => ({
      ...e,
      order: i,
    }));
    save({ events: reordered });
  };

  const handleSaveEvent = () => {
    if (!editEvent) return;
    updateData((d) => ({
      events: d.events.map((e) => (e.id === editEvent.id ? editEvent : e)),
    }));
    setEditEvent(null);
  };

  const handleDeleteEvent = (eventId: string) => {
    updateData((d) => ({
      events: d.events.filter((e) => e.id !== eventId),
    }));
    setEditEvent(null);
    setDeleteConfirm(null);
  };

  const toggleCharacter = (charId: string) => {
    if (!editEvent) return;
    const ids = editEvent.character_ids.includes(charId)
      ? editEvent.character_ids.filter((id) => id !== charId)
      : [...editEvent.character_ids, charId];
    setEditEvent({ ...editEvent, character_ids: ids });
  };

  const sortedEvents = [...data.events].sort((a, b) => a.order - b.order);
  const filteredEvents = filterCategories.length > 0
    ? sortedEvents.filter((e) => e.category_id && filterCategories.includes(e.category_id))
    : sortedEvents;

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading timeline…</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-background overflow-hidden">
      {/* Toolbar */}
      <div className="h-10 border-b border-border flex items-center gap-2 px-4 shrink-0">
        <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={handleAddEvent}>
          <Plus className="h-3.5 w-3.5" /> Add Event
        </Button>
        {worldCategories.length > 0 && (
          <Select
            value={filterCategories.length === 0 ? "__all" : filterCategories[0]}
            onValueChange={(v) => setFilterCategories(v === "__all" ? [] : [v])}
          >
            <SelectTrigger className="h-7 w-[140px] text-xs">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All categories</SelectItem>
              {worldCategories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                    {c.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto p-6">
        {filteredEvents.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-3">
              <Clock className="h-10 w-10 text-muted-foreground mx-auto" />
              <p className="text-sm font-medium text-foreground">No events yet</p>
              <p className="text-xs text-muted-foreground">
                Click "Add Event" to start mapping your story's timeline.
              </p>
            </div>
          </div>
        ) : (
          <div className="max-w-lg mx-auto">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={filteredEvents.map((e) => e.id)} strategy={verticalListSortingStrategy}>
                {filteredEvents.map((event) => (
                  <SortableEventCard
                    key={event.id}
                    event={event}
                    worldCategories={worldCategories}
                    characters={characters}
                    onClick={() => setEditEvent({ ...event })}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        )}
      </div>

      {/* Edit event dialog */}
      <Dialog open={!!editEvent} onOpenChange={(o) => { if (!o) handleSaveEvent(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Event</DialogTitle>
          </DialogHeader>
          {editEvent && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Title</label>
                <Input
                  value={editEvent.title}
                  onChange={(e) => setEditEvent({ ...editEvent, title: e.target.value })}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Date / Period</label>
                <Input
                  value={editEvent.date}
                  onChange={(e) => setEditEvent({ ...editEvent, date: e.target.value })}
                  placeholder="e.g. Chapter 3, Year 1042, Day 5…"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Description</label>
                <CreativeAITextField sourceModule="timeline">
                  <MiniTipTapEditor
                    value={editEvent.description}
                    onChange={(html) => setEditEvent({ ...editEvent, description: html })}
                    className="min-h-[80px]"
                    placeholder="Describe this event…"
                  />
                </CreativeAITextField>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Category</label>
                <Select
                  value={editEvent.category_id ?? "__none"}
                  onValueChange={(v) => setEditEvent({ ...editEvent, category_id: v === "__none" ? null : v })}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">None</SelectItem>
                    {worldCategories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        <span className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                          {c.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {characters.length > 0 && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Characters</label>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {characters.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => toggleCharacter(c.id)}
                        className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                          editEvent.character_ids.includes(c.id)
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-card text-foreground border-border hover:bg-accent"
                        }`}
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex justify-between pt-2 border-t border-border">
                {deleteConfirm === editEvent.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-destructive">Delete this event?</span>
                    <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => handleDeleteEvent(editEvent.id)}>
                      Yes, delete
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setDeleteConfirm(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => setDeleteConfirm(editEvent.id)}>
                    <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                  </Button>
                )}
                <Button size="sm" onClick={handleSaveEvent}>Save</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
