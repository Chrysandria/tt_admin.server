import { createHmac } from 'node:crypto';
import { FacebookGraphService } from './facebook-graph.service.js';

describe('FacebookGraphService', () => {
  let service: FacebookGraphService;
  const originalEnvironment = {
    pageId: process.env.FACEBOOK_PAGE_ID,
    token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN,
    appSecret: process.env.FACEBOOK_APP_SECRET,
    version: process.env.FACEBOOK_GRAPH_API_VERSION,
  };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.FACEBOOK_PAGE_ID = 'page-1';
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'page-token';
    process.env.FACEBOOK_APP_SECRET = 'app-secret';
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
    if (originalEnvironment.appSecret === undefined) {
      delete process.env.FACEBOOK_APP_SECRET;
    } else {
      process.env.FACEBOOK_APP_SECRET = originalEnvironment.appSecret;
    }
    if (originalEnvironment.version === undefined) {
      delete process.env.FACEBOOK_GRAPH_API_VERSION;
    } else {
      process.env.FACEBOOK_GRAPH_API_VERSION = originalEnvironment.version;
    }
  });

  it('publishes a text-only post using the Page feed endpoint', async () => {
    await expect(
      service.publishPagePost('Nouvelle collection'),
    ).resolves.toBe('published-1');

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
        appsecret_proof: createHmac('sha256', 'app-secret')
          .update('page-token')
          .digest('hex'),
      }),
    );
  });

  it('builds a Messenger link from the configured Page ID', () => {
    expect(service.getMessengerLink()).toBe('https://m.me/page-1');
  });

  it('deletes a Page post using the Page token and appsecret proof', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );

    await expect(service.deletePagePost('123_456')).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v99.0/123_456?access_token=page-token&appsecret_proof=' +
        createHmac('sha256', 'app-secret').update('page-token').digest('hex'),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('rejects a failed Facebook post deletion', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: 'Permission denied' } }),
        { status: 403 },
      ),
    );

    await expect(service.deletePagePost('post-1')).rejects.toThrow(
      'Facebook Graph API refused the request: Permission denied',
    );
  });

  it('uploads a verified JPEG with its caption to the Page photos endpoint', async () => {
    const image = {
      buffer: Buffer.from([0xff, 0xd8, 0xff]),
      mimetype: 'image/jpeg',
      originalname: 'product.jpg',
      size: 3,
    } as Express.Multer.File;

    await expect(
      service.publishPagePost('Nouvelle collection', image),
    ).resolves.toBe('published-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v99.0/page-1/photos',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(FormData),
      }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    if (!(request?.body instanceof FormData)) {
      throw new Error('Expected the photo request body to be multipart form data');
    }
    expect(request.body.get('appsecret_proof')).toBe(
      createHmac('sha256', 'app-secret').update('page-token').digest('hex'),
    );
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
