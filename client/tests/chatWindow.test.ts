import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  ChatWindow,
  formatMessageTime,
  scrollToLatestMessage,
  type ChatMessage,
} from '../src/components/ChatWindow';

describe('ChatWindow', () => {
  it('renders the empty state when there are no messages', () => {
    const html = renderToStaticMarkup(React.createElement(ChatWindow, { messages: [] }));
    expect(html).toContain('No messages yet.');
    expect(html).toContain('Send a message to start chatting!');
  });

  it('renders own messages right-aligned and peer messages left-aligned with sender and HH:MM timestamp', () => {
    const timestamp = new Date(2026, 0, 15, 9, 5).getTime();
    const messages: ChatMessage[] = [
      {
        id: '1',
        sender: 'You',
        content: 'Ahoy there!',
        timestamp,
        isMine: true,
      },
      {
        id: '2',
        sender: 'Peer',
        content: 'Ahoy back!',
        timestamp,
        isMine: false,
      },
    ];

    const html = renderToStaticMarkup(React.createElement(ChatWindow, { messages }));

    expect(html).toContain('justify-end');
    expect(html).toContain('bg-emerald-600');
    expect(html).toContain('You');
    expect(html).toContain('Ahoy there!');

    expect(html).toContain('justify-start');
    expect(html).toContain('bg-slate-800');
    expect(html).toContain('Peer');
    expect(html).toContain('Ahoy back!');

    expect(html).toContain('09:05');
  });

  it('renders system messages centered', () => {
    const timestamp = new Date(2026, 0, 15, 14, 30).getTime();
    const messages: ChatMessage[] = [
      {
        id: 'sys-1',
        sender: 'System',
        content: 'A user joined the room',
        timestamp,
        isMine: false,
        type: 'system',
      },
    ];

    const html = renderToStaticMarkup(React.createElement(ChatWindow, { messages }));

    expect(html).toContain('justify-center');
    expect(html).toContain('A user joined the room');
    expect(html).toContain('14:30');
  });

  it('formats timestamps as zero-padded HH:MM', () => {
    const ts = new Date(2026, 0, 15, 7, 3).getTime();
    expect(formatMessageTime(ts)).toBe('07:03');
  });

  it('auto-scrolls the target element to the bottom', () => {
    const scrollIntoView = vi.fn();
    scrollToLatestMessage({ scrollIntoView });

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'end',
    });
  });
});
