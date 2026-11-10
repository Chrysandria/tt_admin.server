import { FacebookGraphService } from './facebook-graph.service.js';

describe('FacebookGraphService', () => {
  let service: FacebookGraphService;
  const originalEnvironment = {
    pageId: process.env.FACEBOOK_PAGE_ID,
    token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN,
    version: process.env.FACEBOOK_GRAPH_API_VERSION,
  };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.FACEBOOK_PAGE_ID = 'page-1';
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'page-token';
    process.env.FACEBOOK_GRAPH_API_VERSION = 'v99.0';
    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'published-1' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    service = new FacebookGraphService();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalEnvironment.pageId === undefined) {
      delete process.env.FACEBOOK_PAGE_ID;
    } else {
      process.env.FACEBOOK_PAGE_ID = originalEnvironment.pageId;
    }
    if (originalEnvironment.token === undefined) {
      delete process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    } else {
      process.env.FACEBOOK_PAGE_ACCESS_TOKEN = originalEnvironment.token;
    }
    if (originalEnvironment.version === undefined) {
      delete process.env.FACEBOOK_GRAPH_API_VERSION;
    } else {
      process.env.FACEBOOK_GRAPH_API_VERSION = originalEnvironment.version;
    }
  });

  it('publishes a text-only post using the Page feed endpoint', async () => {
    await service.publishPagePost('Nouvelle collection');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v99.0/page-1/feed',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(URLSearchParams),
      }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(request?.body).toEqual(
      new URLSearchParams({
        message: 'Nouvelle collection',
        access_token: 'page-token',
      }),
    );
  });

  it('builds a Messenger link from the configured Page ID', () => {
    expect(service.getMessengerLink()).toBe('https://m.me/page-1');
  });

  it('uploads a verified JPEG with its caption to the Page photos endpoint', async () => {
    const image = {
      buffer: Buffer.from([0xff, 0xd8, 0xff]),
      mimetype: 'image/jpeg',
      originalname: 'product.jpg',
      size: 3,
    } as Express.Multer.File;

    await service.publishPagePost('Nouvelle collection', image);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v99.0/page-1/photos',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(FormData),
      }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(request?.body).toBeInstanceOf(FormData);
  });

  it('rejects invalid image bytes before calling Meta', async () => {
    const image = {
      buffer: Buffer.from('not an image'),
      mimetype: 'image/jpeg',
      originalname: 'product.jpg',
      size: 12,
    } as Express.Multer.File;

    await expect(service.publishPagePost('Publication', image)).rejects.toThrow(
      'Publication image must be a valid JPEG or PNG file',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
