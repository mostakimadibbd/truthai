/*
 * Xyro AI — invisible image watermark (C core).
 *
 * Embeds a short payload (e.g. "xyro:<generationId>") into the
 * least significant bits of a raw pixel buffer, one bit per byte,
 * and extracts it back. The Python fallback in app/watermark.py
 * implements the identical format so behaviour matches with or
 * without this library compiled. (Measured note: the algorithm
 * touches only the payload region — (6 + payload) * 8 bytes — so
 * at production payload sizes both engines run in well under a
 * millisecond; the C core is the native implementation of the
 * format, not a performance claim.)
 *
 * Frame format (embedded MSB-first into successive LSBs):
 *   bytes 0..3   magic "XYRO"
 *   bytes 4..5   payload length, big-endian uint16
 *   bytes 6..    payload bytes
 * Total bits needed: (6 + payload_len) * 8, one bit per buffer byte.
 *
 * Return codes: 0 ok, -1 buffer too small, -2 bad magic / corrupt,
 * -3 output buffer too small.
 */
#include <stddef.h>
#include <stdint.h>
#include <string.h>

static const unsigned char WM_MAGIC[4] = {'X', 'Y', 'R', 'O'};
static const size_t WM_HEADER_BYTES = 6;

static void embed_byte(unsigned char *dst, unsigned char value) {
    for (int bit = 7; bit >= 0; --bit) {
        size_t idx = (size_t)(7 - bit);
        dst[idx] = (unsigned char)((dst[idx] & 0xFEu) | ((value >> bit) & 1u));
    }
}

static unsigned char extract_byte(const unsigned char *src) {
    unsigned char value = 0;
    for (int i = 0; i < 8; ++i) {
        value = (unsigned char)((value << 1) | (src[i] & 1u));
    }
    return value;
}

int wm_embed(unsigned char *data, size_t len,
             const unsigned char *payload, size_t payload_len) {
    if (payload_len > 0xFFFFu) return -1;
    size_t needed = (WM_HEADER_BYTES + payload_len) * 8;
    if (len < needed) return -1;

    unsigned char header[WM_HEADER_BYTES];
    memcpy(header, WM_MAGIC, 4);
    header[4] = (unsigned char)((payload_len >> 8) & 0xFFu);
    header[5] = (unsigned char)(payload_len & 0xFFu);

    size_t offset = 0;
    for (size_t i = 0; i < WM_HEADER_BYTES; ++i) {
        embed_byte(data + offset, header[i]);
        offset += 8;
    }
    for (size_t i = 0; i < payload_len; ++i) {
        embed_byte(data + offset, payload[i]);
        offset += 8;
    }
    return 0;
}

int wm_extract(const unsigned char *data, size_t len,
               unsigned char *out, size_t out_cap, size_t *out_len) {
    if (len < WM_HEADER_BYTES * 8) return -2;

    unsigned char header[WM_HEADER_BYTES];
    size_t offset = 0;
    for (size_t i = 0; i < WM_HEADER_BYTES; ++i) {
        header[i] = extract_byte(data + offset);
        offset += 8;
    }
    if (memcmp(header, WM_MAGIC, 4) != 0) return -2;

    size_t payload_len = ((size_t)header[4] << 8) | (size_t)header[5];
    if (len < (WM_HEADER_BYTES + payload_len) * 8) return -2;
    if (out_cap < payload_len) return -3;

    for (size_t i = 0; i < payload_len; ++i) {
        out[i] = extract_byte(data + offset);
        offset += 8;
    }
    if (out_len) *out_len = payload_len;
    return 0;
}

/* Capacity helper: how many payload bytes fit in a buffer. */
size_t wm_capacity(size_t len) {
    size_t total = len / 8;
    return total > WM_HEADER_BYTES ? total - WM_HEADER_BYTES : 0;
}
