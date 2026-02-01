export interface Point {
    x: number;
    y: number;
}

export type Line = Point[];

/**
 * Renders a list of drawing lines to a PNG data URL.
 * Used for providing visual context to the AI assistant.
 */
export function renderDrawingToPNG(lines: Line[], height: number): string {
    const canvas = document.createElement('canvas');
    canvas.width = 500;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    // Match editor background for consistency
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#4a9eff';
    ctx.lineWidth = 2;

    lines.forEach((line) => {
        if (Array.isArray(line) && line.length > 0) {
            ctx.beginPath();
            line.forEach((point, index) => {
                if (index === 0) ctx.moveTo(point.x, point.y);
                else ctx.lineTo(point.x, point.y);
            });
            ctx.stroke();
        }
    });

    return canvas.toDataURL('image/png');
}
