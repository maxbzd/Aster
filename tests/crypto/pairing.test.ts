import { describe, expect, it } from 'vitest'
import { checkDigits, finishJoin, readJoinRequest, startJoin } from '@/crypto/pairing'
import { randomBytes, toBase64 } from '@/crypto/bytes'

const PURPOSE = 'aster/cloud-key'

describe('moving the cloud key to a new device', () => {
  it('works end to end, and both screens show the same check digits', async () => {
    const secret = randomBytes(32)
    const newDevice = await startJoin()
    const oldDevice = await readJoinRequest(newDevice.code)
    expect(oldDevice.checkDigits).toBe(newDevice.checkDigits)
    expect(newDevice.checkDigits).toMatch(/^\d{4} \d{4} \d{4}$/)
    const answer = await oldDevice.seal(secret, PURPOSE)
    expect([...(await finishJoin(newDevice, answer, PURPOSE))]).toEqual([...secret])
  })

  it('the answer is useless to anyone but the device that asked', async () => {
    const secret = randomBytes(32)
    const asked = await startJoin()
    const other = await startJoin()
    const answer = await (await readJoinRequest(asked.code)).seal(secret, PURPOSE)
    await expect(finishJoin(other, answer, PURPOSE)).rejects.toMatchObject({ code: 'wrong_password' })
    expect(answer).not.toContain(toBase64(secret)) // nothing readable in it
  })

  it('an answer made for another purpose, or another request, is refused', async () => {
    const asked = await startJoin()
    const answer = await (await readJoinRequest(asked.code)).seal(randomBytes(32), PURPOSE)
    await expect(finishJoin(asked, answer, 'aster/something-else')).rejects.toMatchObject({ code: 'wrong_password' })
  })

  it('a swapped request shows different check digits, which is how the person catches it', async () => {
    const real = await startJoin()
    const attacker = await startJoin()
    expect(attacker.checkDigits).not.toBe(real.checkDigits)
    expect(await checkDigits(attacker.code)).not.toBe(await checkDigits(real.code))
  })

  it('forgives spaces, line breaks and quotes around a pasted code', async () => {
    const asked = await startJoin()
    const pasted = `  “${asked.code.slice(0, 40)}\n${asked.code.slice(40)}  `
    expect((await readJoinRequest(pasted.replace('“', '"'))).checkDigits).toBe(asked.checkDigits)
  })

  it('says clearly when a code is not one, or is cut short', async () => {
    await expect(readJoinRequest('hello')).rejects.toMatchObject({ code: 'invalid_payload' })
    const asked = await startJoin()
    await expect(readJoinRequest(asked.code.slice(0, 200))).rejects.toMatchObject({ code: 'invalid_payload' })
    await expect(finishJoin(asked, 'JOIN1.abc', PURPOSE)).rejects.toMatchObject({ code: 'invalid_payload' })
    await expect(finishJoin(asked, 'SEAL1.%%%', PURPOSE)).rejects.toMatchObject({ code: 'invalid_payload' })
  })
})
