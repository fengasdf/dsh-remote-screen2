// Guacamole protocol helpers: a streaming instruction parser and an encoder.
//
// Instruction form: <length>.<element>[,<length>.<element>...];
// Lengths count Unicode code points, as the Apache Guacamole JavaScript client
// does. The parser is used only for the guacd handshake (ASCII); display
// instructions are relayed verbatim once the connection is ready.

export function codePointLength(text) {
  let count = 0
  for (const _ of text) count += 1
  return count
}

export function encodeInstruction(elements) {
  return (
    elements
      .map((element) => {
        const text = element === null || element === undefined ? '' : String(element)
        return `${codePointLength(text)}.${text}`
      })
      .join(',') + ';'
  )
}

export class GuacParser {
  constructor(onInstruction) {
    this.onInstruction = onInstruction
    this.buffer = ''
  }

  receive(text) {
    if (!text) return
    this.buffer += text
    this.#drain()
  }

  #drain() {
    for (;;) {
      let index = 0
      const elements = []
      let raw = null
      while (index < this.buffer.length) {
        const dot = this.buffer.indexOf('.', index)
        if (dot === -1) return
        const length = Number(this.buffer.slice(index, dot))
        if (!Number.isInteger(length) || length < 0) {
          // Not a Guacamole stream any more; drop what we buffered.
          this.buffer = ''
          return
        }
        let position = dot + 1
        let consumed = 0
        while (position < this.buffer.length && consumed < length) {
          const code = this.buffer.codePointAt(position)
          position += code > 0xffff ? 2 : 1
          consumed += 1
        }
        if (consumed < length) return
        elements.push(this.buffer.slice(dot + 1, position))
        const terminator = this.buffer[position]
        if (terminator === ',') {
          index = position + 1
          continue
        }
        if (terminator === ';') {
          raw = this.buffer.slice(0, position + 1)
          this.buffer = this.buffer.slice(position + 1)
          break
        }
        this.buffer = ''
        return
      }
      if (raw === null) return
      const [opcode, ...params] = elements
      this.onInstruction(opcode, params, raw)
    }
  }
}
