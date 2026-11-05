import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { ClientDto, ClientInput } from '@electro/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { toClientDto } from '../common/mappers.js';

const withCount = { _count: { select: { projects: true } } } as const;

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string, search?: string): Promise<ClientDto[]> {
    const q = search?.trim();
    const clients = await this.prisma.client.findMany({
      where: {
        organizationId,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { email: { contains: q, mode: 'insensitive' } },
                { phone: { contains: q } },
                { address: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: withCount,
      orderBy: { name: 'asc' },
      take: 500,
    });
    return clients.map(toClientDto);
  }

  async get(organizationId: string, id: string): Promise<ClientDto> {
    const client = await this.prisma.client.findFirst({ where: { id, organizationId }, include: withCount });
    if (!client) throw new NotFoundException('Client not found.');
    return toClientDto(client);
  }

  async create(organizationId: string, input: ClientInput): Promise<ClientDto> {
    const client = await this.prisma.client.create({
      data: { organizationId, ...input },
      include: withCount,
    });
    return toClientDto(client);
  }

  async update(organizationId: string, id: string, input: ClientInput): Promise<ClientDto> {
    await this.get(organizationId, id);
    const client = await this.prisma.client.update({ where: { id }, data: input, include: withCount });
    return toClientDto(client);
  }

  async remove(organizationId: string, id: string): Promise<void> {
    const client = await this.get(organizationId, id);
    if (client.projectCount > 0) {
      throw new ConflictException(
        `This client still has ${client.projectCount} project(s). Delete or move them before deleting the client.`,
      );
    }
    await this.prisma.client.delete({ where: { id } });
  }
}
