import { createRouteHandlerClient, createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { SupabaseClient, createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  DbMdxPreview,
  DbMod,
  DbModAuthor,
  DbRelease,
  DbReleaseFile,
  DbUpload,
  DbUser,
  DbUserNotification,
} from "./Database";
import { WrappedSupabaseClient, from } from "./API.Statement";

export { useApi, ApiProvider, type ApiProviderProps } from "./API.Hooks";

export interface RestUser extends DbUser {}
export interface RestUserPersonal extends RestUser {
  mod_nuggets: number[];
  mod_subscriptions: number[];
  notifications: RestUserNotification[];
}
export interface RestUserNotification extends DbUserNotification {}

export interface RestMod extends DbMod {
  authors: RestModAuthor[];
}
export interface RestModWithReleases extends RestMod {
  releases: RestRelease[];
}
export interface RestModAuthor extends DbModAuthor {
  user: RestUser;
}

export interface RestUpload extends DbUpload {}

export interface RestRelease extends DbRelease {
  files: RestReleaseFile[];
}
export interface RestReleaseWithMod extends RestRelease {
  mod: RestMod;
}
export interface RestReleaseFile extends DbReleaseFile {
  upload: RestUpload;
}

//

//

const selectUserNotification = from("user_notifications").select<RestUserNotification>("*");

const selectUser = from("users").select<RestUser>("*");
const selectUserPersonal = from("users").select<RestUserPersonal>("*", {
  mod_nuggets: "get_user_nuggets",
  mod_subscriptions: "get_user_subscriptions",
  notifications: selectUserNotification.multiple,
});

const selectModAuthor = from("mod_authors").select<RestModAuthor>({
  user: selectUser,
});
const selectMod = from("mods").select<RestMod>({
  authors: selectModAuthor.multiple,
});

const selectUpload = from("uploads").select<RestUpload>({});

const selectReleaseFile = from("release_files").select<RestReleaseFile>({
  upload: selectUpload,
});
const selectRelease = from("releases").select<RestRelease>({
  files: selectReleaseFile.multiple,
});

const selectReleaseWithMod = from("releases").select<RestReleaseWithMod>({
  files: selectReleaseFile.multiple,
  mod: selectMod,
});
const selectModWithReleases = from("mods").select<RestModWithReleases>({
  authors: selectModAuthor.multiple,
  releases: selectRelease.multiple,
});

//

//

const selectMdxPreview = from("mdx_previews").select<DbMdxPreview>({});

//

//

export class RogueLibsApi extends WrappedSupabaseClient {
  public constructor(Supabase: SupabaseClient, currentUser: RestUserPersonal | null) {
    super(Supabase);
    this.currentUser = currentUser;
  }

  currentUser: RestUserPersonal | null = null;

  public async getSession() {
    return (await this.Supabase.auth.getSession()).data.session;
  }

  public fetchModById(id: number) {
    return this.selectOne(selectMod, m => m.eq("id", id));
  }
  public fetchModBySlug(slug: string | number) {
    if (!Number.isNaN(+slug)) return this.fetchModById(+slug);
    return this.selectOne(selectMod, r => r.eq("slug", slug));
  }

  public fetchModWithReleasesById(id: number) {
    return this.selectOne(selectModWithReleases, m => m.eq("id", id));
  }
  public fetchModWithReleasesBySlug(slug: string | number) {
    if (!Number.isNaN(+slug)) return this.fetchModWithReleasesById(+slug);
    return this.selectOne(selectModWithReleases, m => m.eq("slug", slug));
  }

  public fetchReleaseById(id: number) {
    return this.selectOne(selectReleaseWithMod, r => r.eq("id", id));
  }
  public fetchReleaseBySlug(mod_slug: string | number, release_slug: string | number) {
    if (!Number.isNaN(+release_slug)) return this.fetchReleaseById(+release_slug);
    return this.selectOne(selectReleaseWithMod, r => {
      r.eq(Number.isNaN(+mod_slug) ? "mod.slug" : "id", mod_slug).eq("slug", release_slug);
    });
  }

  public fetchReleasesByModId(mod_id: number) {
    return this.selectMany(selectRelease, r => r.eq("mod_id", mod_id));
  }

  public fetchTopMods(limit: number | [start: number, end: number]) {
    return this.selectMany(selectMod, m => m.order("nugget_count", { ascending: false }), limit);
  }

  public fetchUserById<IsPersonal extends boolean | undefined = false>(
    user_id: string,
    is_personal?: IsPersonal,
  ): Promise<IsPersonal extends true ? RestUserPersonal : RestUser> {
    if (!is_personal) return this.selectOne(selectUser, u => u.eq("id", user_id)) as never;
    return this.selectOne(selectUserPersonal, u => u.eq("id", user_id)).then(
      user => (user?.notifications.reverse(), user),
    ) as never;
  }

  public setModNugget(mod_id: number, nugget: boolean) {
    return this.rpc("set_mod_nugget", { _mod_id: mod_id, _nugget: nugget });
  }
  public setModSubscription(mod_id: number, subscription: boolean) {
    return this.rpc("set_mod_subscription", { _mod_id: mod_id, _subscription: subscription });
  }

  public async downloadFile(upload: DbUpload) {
    const res = await this.Supabase.storage.from("uploads").download(upload.id + "/" + upload.filename);
    return res.data;
  }
  public async signFileUrl(upload: DbUpload) {
    const res = await this.Supabase.storage.from("uploads").createSignedUrl(upload.id + "/" + upload.filename, 60);
    return res.data?.signedUrl ?? null;
  }

  public fetchMdxPreview(uid: string) {
    return this.selectOne(selectMdxPreview, p => p.eq("uid", uid));
  }
  public upsertMdxPreview(source: string) {
    return this.rpc("upsert_mdx_preview", { _source: source });
  }
}

export function createServerApi(
  cxt: { headers: () => any; cookies: () => any } | { cookies: () => any },
  nextOptions?: { revalidate?: number | false; tags?: string[] } | false,
) {
  const customFetch = (req: any, options: any) => {
    if (!options) options = {};
    if (nextOptions) {
      options.next = nextOptions;
    }
    if ((nextOptions == null && options.cache == null) || nextOptions === false) {
      options.cache = "no-cache";
    }
    return fetch(req, options);
  };
  let supabase: SupabaseClient;
  if ("headers" in cxt) {
    supabase = createServerComponentClient(cxt, { options: { global: { fetch: customFetch } } });
  } else {
    supabase = createRouteHandlerClient(cxt, { options: { global: { fetch: customFetch } } });
  }
  return new RogueLibsApi(supabase, null);
}

export function createServiceApi(service: "SERVICE_ROLE_API") {
  if (service !== "SERVICE_ROLE_API") return null!;
  const supabase = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, {
    auth: { flowType: "pkce" },
  });
  return new RogueLibsApi(supabase, null);
}
