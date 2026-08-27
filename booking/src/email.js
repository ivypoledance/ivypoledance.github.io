// Transactional mail. The provider is behind one function so it can be swapped
// without touching the templates: both Mailjet and Brevo are French, have free
// tiers well above this site's volume, and take a single JSON POST.

const WEEKDAYS = ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.'];
const MONTHS_OK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** "Do. 27.08.2026, 17:00", matching how dates read on the site. */
export function formatDateTime(value) {
  if (!value || !MONTHS_OK.test(value)) return String(value ?? '');
  const [date, time] = value.split('T');
  const [y, m, d] = date.split('-');
  // Parsed as UTC deliberately: the CSV carries local wall-clock times with no
  // zone, and reformatting them must not shift the hour.
  const weekday = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return `${weekday} ${d}.${m}.${y}, ${time.slice(0, 5)}`;
}

/** Both dates of a two-part course, or just the one. */
export function formatEventDates(event) {
  const parts = [formatDateTime(event.starts_at)];
  if (event.ends_at) parts[0] += `-${formatDateTime(event.ends_at).split(', ')[1]}`;
  if (event.second_starts_at) {
    let second = formatDateTime(event.second_starts_at);
    if (event.second_ends_at) second += `-${formatDateTime(event.second_ends_at).split(', ')[1]}`;
    parts.push(second);
  }
  return parts.join(' & ');
}

function courseLabel(event) {
  return event.name ? `${event.course_title} – ${event.name}` : event.course_title;
}

export function confirmationEmail({ event, booking, siteUrl, paymentNote }) {
  const course = courseLabel(event);
  const dates = formatEventDates(event);
  return {
    subject: `Buchungsbestätigung: ${course}`,
    text: [
      `Hallo ${booking.name},`,
      '',
      `dein Platz ist reserviert:`,
      '',
      `  Kurs:   ${course}`,
      `  Termin: ${dates}`,
      event.price ? `  Preis:  ${event.price}` : null,
      '',
      paymentNote,
      '',
      `Mit der Überweisung bestätigst du die AGB inklusive Stornoregelung:`,
      `${siteUrl}/imprint/#agb`,
      '',
      'Bis bald!',
      'Ivy Poledance',
    ].filter((line) => line !== null).join('\n'),
  };
}

export function waitlistEmail({ event, booking, position, siteUrl }) {
  const course = courseLabel(event);
  return {
    subject: `Warteliste: ${courseLabel(event)}`,
    text: [
      `Hallo ${booking.name},`,
      '',
      `dieser Termin ist derzeit ausgebucht, du stehst auf der Warteliste:`,
      '',
      `  Kurs:     ${course}`,
      `  Termin:   ${formatEventDates(event)}`,
      `  Position: ${position}`,
      '',
      'Sobald ein Platz frei wird, wirst du der Reihenfolge nach per E-Mail verständigt.',
      'Es entstehen dir keine Kosten.',
      '',
      `Alle Kurse: ${siteUrl}/courses/courses-and-booking/booking/`,
      '',
      'Liebe Grüße',
      'Ivy Poledance',
    ].join('\n'),
  };
}

export function ownerNotificationEmail({ event, booking, status, counts }) {
  return {
    subject: `${status === 'confirmed' ? 'Neue Buchung' : 'Neu auf Warteliste'}: ${courseLabel(event)}`,
    text: [
      `${booking.name} <${booking.email}>`,
      '',
      `Kurs:   ${courseLabel(event)}`,
      `Termin: ${formatEventDates(event)}`,
      `Status: ${status}`,
      `Belegt: ${counts.confirmed}${event.capacity === null ? ' (kein Limit)' : `/${event.capacity}`}`
        + `${counts.waitlist ? ` (Warteliste: ${counts.waitlist})` : ''}`,
    ].join('\n'),
  };
}

/**
 * Sends one message. Returns false rather than throwing: a booking that is
 * already stored must not be reported as failed because mail was refused.
 */
export async function sendEmail(env, { to, subject, text, replyTo }, fetchImpl = fetch) {
  const from = env.FROM_EMAIL;
  if (!from || !env.MAIL_API_KEY) return false;

  const provider = (env.MAIL_PROVIDER || 'mailjet').toLowerCase();
  const request = provider === 'brevo'
    ? {
      url: 'https://api.brevo.com/v3/smtp/email',
      headers: { 'api-key': env.MAIL_API_KEY, 'content-type': 'application/json' },
      body: {
        sender: { email: from, name: env.FROM_NAME || 'Ivy Poledance' },
        to: [{ email: to }],
        subject,
        textContent: text,
        ...(replyTo ? { replyTo: { email: replyTo } } : {}),
      },
    }
    : {
      url: 'https://api.mailjet.com/v3.1/send',
      headers: {
        // Mailjet authenticates with key:secret over Basic auth.
        authorization: `Basic ${btoa(`${env.MAIL_API_KEY}:${env.MAIL_API_SECRET ?? ''}`)}`,
        'content-type': 'application/json',
      },
      body: {
        Messages: [{
          From: { Email: from, Name: env.FROM_NAME || 'Ivy Poledance' },
          To: [{ Email: to }],
          Subject: subject,
          TextPart: text,
          ...(replyTo ? { ReplyTo: { Email: replyTo } } : {}),
        }],
      },
    };

  try {
    const response = await fetchImpl(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
    });
    return response.ok;
  } catch {
    return false;
  }
}
