import type { FileMeta } from '../../types/sync';

interface PropertyPillsProps {
    meta: FileMeta;
    onClick?: () => void;
}

export default function PropertyPills({ meta, onClick }: PropertyPillsProps) {
    const pills: { label: string; value: string }[] = [];

    if (meta.subject) pills.push({ label: 'Subject', value: meta.subject });
    if (meta.week !== undefined && meta.week !== null) pills.push({ label: 'Week', value: String(meta.week) });
    if (meta.module) pills.push({ label: 'Module', value: meta.module });
    if (meta.type === 'task') {
        if (meta.priority) pills.push({ label: 'Priority', value: meta.priority });
        if (meta.status) pills.push({ label: 'Status', value: meta.status });
        if (meta.dueDate) pills.push({ label: 'Due', value: meta.dueDate });
    }

    // Include custom properties (skip internal keys)
    if (meta.properties) {
        Object.entries(meta.properties)
            .filter(([k]) => !k.startsWith('__'))
            .forEach(([key, val]) => {
                if (val === undefined || val === null || val === '' || val === '__auto__') return;
                const type = meta.properties?.[`__type_${key}`] ?? 'text';
                let display = String(val);
                if (type === 'boolean') display = val ? 'Yes' : 'No';
                else if (type === 'rating') display = '★'.repeat(Number(val) || 0);
                else if (type === 'progress') display = `${val}%`;
                else if (type === 'multiselect') {
                    try { display = JSON.parse(val).join(', '); } catch { /* ignore */ }
                }
                if (display && display !== '0' && display !== '[]') {
                    pills.push({ label: key, value: display });
                }
            });
    }

    if (pills.length === 0) return null;

    return (
        <div
            className="flex flex-wrap gap-1.5 cursor-pointer"
            onClick={onClick}
            title="Click to edit properties"
        >
            {pills.map(({ label, value }) => (
                <span
                    key={label}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-violet-500/10 text-violet-300/80 border border-violet-500/10 hover:border-violet-500/20 transition-colors"
                >
                    <span className="font-semibold text-zinc-500">{label}:</span>
                    <span>{value}</span>
                </span>
            ))}
        </div>
    );
}
