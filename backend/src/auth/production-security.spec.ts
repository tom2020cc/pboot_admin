import { ConfigService } from '@nestjs/config';
import { jwtSecret } from './constants';
import { JwtStrategy } from './jwt.strategy';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import * as bcrypt from 'bcryptjs';

describe('production authentication', () => {
  it('requires a production signing secret and preserves local compatibility', () => {
    expect(() => jwtSecret('', true)).toThrow('JWT_SECRET');
    expect(() => jwtSecret('hahaha', true)).toThrow('JWT_SECRET');
    expect(jwtSecret('x'.repeat(64), true)).toBe('x'.repeat(64));
    expect(jwtSecret('', false)).toBe('hahaha');
  });
  it('checks that the authenticated account still exists', async () => {
    const users = { findOneById: jest.fn().mockResolvedValue({ id: 1, email: 'current@example.invalid' }) };
    const strategy = new JwtStrategy(new ConfigService({ JWT_SECRET: 'x'.repeat(64), NODE_ENV: 'production' }), users as any);
    expect(await strategy.validate({ sub: 1, email: 'old@example.invalid' })).toEqual({ userId: 1, email: 'current@example.invalid' });
    users.findOneById.mockRejectedValue(new Error('removed'));
    await expect(strategy.validate({ sub: 1, email: '' })).rejects.toThrow();
    await expect(strategy.validate({ sub: 0, email: '' })).rejects.toThrow();
  });
  it('disables anonymous registration in production', () => {
    const old = process.env.NODE_ENV;
    const users = { create: jest.fn() };
    try {
      process.env.NODE_ENV = 'production';
      const controller = new AuthController({} as any, users as any);
      expect(() => controller.create({ email: 'test@example.invalid', password: 'not-a-real-password' })).toThrow('不开放公开注册');
      expect(users.create).not.toHaveBeenCalled();
    } finally { process.env.NODE_ENV = old; }
  });
  it('does not log passwords or hashes during login', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const service = new AuthService({ findOneBy: async () => ({ id: 1, email: 'test@example.invalid', password: bcrypt.hashSync('test-fixture-password', 4) }) } as any, { sign: () => 'test-token' } as any);
      await service.login({ email: 'test@example.invalid', password: 'test-fixture-password' });
      await expect(service.login({ email: 'test@example.invalid', password: 'wrong' })).rejects.toThrow();
      expect(log).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
});
