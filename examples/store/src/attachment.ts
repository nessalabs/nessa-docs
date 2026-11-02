export type Attachment = { phase: 'Open' | 'Closed' };

export function close(attachment: Attachment): Attachment {
  if (attachment.phase !== 'Open') return attachment;
  return { phase: 'Closed' };
}

/** A write is refused once the attachment is closed. Closing does not delete the bytes already stored. */
export function write(attachment: Attachment, _bytes: Uint8Array): Attachment {
  if (attachment.phase !== 'Open') throw new Error('Cannot write to a closed attachment');
  return attachment;
}
