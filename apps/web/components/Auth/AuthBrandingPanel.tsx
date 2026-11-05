'use client'
import React from 'react'
import { useTranslation, Trans } from 'react-i18next'
import Image from 'next/image'
import Link from 'next/link'
import learnhouseIcon from 'public/learnhouse_bigicon_1.png'
import { getOrgAuthBackgroundMediaDirectory } from '@services/media/media'
import OrgSquareLogo, { getOrgWideLogoUrl, useTrimmedLogo } from '@components/Objects/Org/OrgSquareLogo'
import { getUriWithOrg } from '@services/config/config'
import { cn } from '@/lib/utils'
import { usePlan } from '@components/Hooks/usePlan'
import { isWhiteLabelPlan } from '@components/Hooks/useLearnHouseBranding'

interface AuthBrandingPanelProps {
  org: any
  welcomeText?: string
  // No-org (apex) panel copy: platform-style title + subtitle shown at the top
  // of the illustration. Falls back to the login wording when omitted.
  title?: string
  subtitle?: string
}

export default function AuthBrandingPanel({ org, welcomeText, title, subtitle }: AuthBrandingPanelProps) {
  const { t } = useTranslation()
  const authBranding = org?.config?.config?.customization?.auth_branding || org?.config?.config?.general?.auth_branding || {}
  const {
    welcome_message = '',
    background_type = 'gradient',
    background_image = '',
    text_color = 'light',
    unsplash_photographer_name = '',
    unsplash_photographer_url = '',
    unsplash_photo_url = '',
  } = authBranding
  const UNSPLASH_UTM = '?utm_source=LearnHouse&utm_medium=referral'
  const withUtm = (url: string) => (url ? `${url}${UNSPLASH_UTM}` : '')

  // Pro+ and EE are white-labelled; OSS keeps the LearnHouse mark
  const plan = usePlan()
  const isWhiteLabel = isWhiteLabelPlan(plan)

  // No org context (the generic apex login) → use the platform's auth
  // illustration instead of the flat gradient.
  const noOrg = !org

  const getBackgroundStyle = (): React.CSSProperties => {
    if (noOrg) {
      return {
        backgroundImage: 'url(/auth-default.webp)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    }
    if (background_type === 'gradient' || !background_image) {
      // Keep the original black gradient
      return {
        background: 'linear-gradient(041.61deg, #202020 7.15%, #000000 90.96%)',
      }
    }
    if (background_type === 'custom' && background_image) {
      return {
        backgroundImage: `url(${getOrgAuthBackgroundMediaDirectory(org?.org_uuid, background_image)})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    }
    if (background_type === 'unsplash' && background_image) {
      return {
        backgroundImage: `url(${background_image})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    }
    return {
      background: 'linear-gradient(041.61deg, #202020 7.15%, #000000 90.96%)',
    }
  }

  const wideLogo = useTrimmedLogo(getOrgWideLogoUrl(org))
  // No-org platform copy (defaults mirror the platform login illustration).
  const noOrgTitle = title || t('auth.image_title_login')
  const noOrgSubtitle =
    subtitle || t('auth.image_subtitle_login')
  // Treat the no-org illustration like a photo background: dark scrim, no
  // blueprint-grid overlay.
  const hasCustomBackground = noOrg || (background_type !== 'gradient' && background_image)

  return (
    <div className="relative h-full w-full">
      {/* Inset rounded card (platform-style) */}
      <div className="absolute inset-16 rounded-2xl overflow-hidden">
        {/* Base layer: org's chosen background (gradient | custom | unsplash) */}
        <div className="absolute inset-0" style={getBackgroundStyle()} />

        {/* Blueprint + dot overlays, ONLY for gradient fallback (no photo) */}
        {!hasCustomBackground && (
          <>
            <div
              className="absolute inset-0 opacity-[0.14]"
              style={{
                backgroundImage: `linear-gradient(rgba(120,165,255,0.6) 1px, transparent 1px),
                  linear-gradient(90deg, rgba(120,165,255,0.6) 1px, transparent 1px),
                  linear-gradient(rgba(120,165,255,0.3) 0.5px, transparent 0.5px),
                  linear-gradient(90deg, rgba(120,165,255,0.3) 0.5px, transparent 0.5px)`,
                backgroundSize: '120px 120px, 120px 120px, 24px 24px, 24px 24px',
              }}
            />
            <div
              className="absolute inset-0 opacity-[0.18]"
              style={{
                backgroundImage: 'radial-gradient(circle, rgba(120,165,255,0.9) 1.5px, transparent 1.5px)',
                backgroundSize: '120px 120px',
              }}
            />
          </>
        )}

        {/* Dark scrim for org photo backgrounds (centered text needs it).
            The no-org illustration stays vivid; it's darkened only at the top. */}
        {hasCustomBackground && !noOrg && (
          <div className="absolute inset-0 bg-black/30" />
        )}

        {/* No-org: top blur + darken so the platform-style heading reads over
            the illustration (mirrors the platform login panel). */}
        {noOrg && (
          <>
            <div
              className="absolute top-0 start-0 end-0 h-[38%] z-[5] backdrop-blur-sm"
              style={{
                maskImage: 'linear-gradient(to bottom, black 10%, transparent 100%)',
                WebkitMaskImage: 'linear-gradient(to bottom, black 10%, transparent 100%)',
              }}
            />
            <div
              className="absolute top-0 start-0 end-0 h-[38%] z-[5] bg-black/35"
              style={{
                maskImage: 'linear-gradient(to bottom, black 10%, transparent 100%)',
                WebkitMaskImage: 'linear-gradient(to bottom, black 10%, transparent 100%)',
              }}
            />
          </>
        )}

        {/* Content */}
        <div className="relative z-10 flex flex-col h-full p-10">
          {/* Top bar with LearnHouse lrn.svg logo - hidden for white-label plans
              and for the no-org apex panel (platform shows no logo on the image). */}
          {!isWhiteLabel && !noOrg && (
            <div className="login-topbar">
              <Link prefetch href="https://learnhouse.app" target="_blank">
                <img
                  src="/lrn.svg"
                  alt="LearnHouse"
                  width={30}
                  height={30}
                  className={cn(
                    "transition-opacity hover:opacity-100",
                    // brightness-0 first: a coloured mark would invert to its complement (wine → teal).
                    text_color === 'light' ? "opacity-60 brightness-0 invert" : "opacity-40"
                  )}
                />
              </Link>
            </div>
          )}

          {noOrg ? (
            /* No-org apex panel, platform layout: heading at the TOP, no logo
               box, platform copy. */
            <div className="max-w-md text-white">
              <h1 className="font-black text-[28px] leading-tight tracking-tight">
                {noOrgTitle}
              </h1>
              <p className="mt-3 text-white/55 text-base font-medium leading-relaxed">
                {noOrgSubtitle}
              </p>
            </div>
          ) : (
            /* Org panel, Prakto: no centered name or welcome line. The photo
               carries the panel; the org wordmark sits bottom-left as a
               "<logo> × Akademi" lockup. */
            <>
              <div className="flex-1" />
              <Link
                prefetch
                href={getUriWithOrg(org?.slug, '/')}
                className={cn(
                  "flex w-fit items-center gap-3",
                  text_color === 'light' ? "text-white" : "text-gray-900"
                )}
              >
                {wideLogo ? (
                  // Straight on the photo, no plate. brightness-0 + invert turns
                  // every opaque pixel white on light-text (dark photo) panels.
                  <img
                    src={wideLogo}
                    alt={org?.name || ''}
                    className={cn(
                      "block h-7 w-auto max-w-[180px]",
                      text_color === 'light' && "brightness-0 invert drop-shadow-sm"
                    )}
                  />
                ) : (
                  <div className="w-10 h-10 rounded-lg ring-1 ring-inset ring-white/10 bg-white flex items-center justify-center overflow-hidden shrink-0">
                    <OrgSquareLogo
                      org={org}
                      wideInsetClassName="p-1.5"
                      fallback={
                        isWhiteLabel ? (
                          <span className="text-lg font-black text-gray-800">
                            {(org?.name || '?').charAt(0).toUpperCase()}
                          </span>
                        ) : (
                          <Image
                            quality={100}
                            width={40}
                            height={40}
                            src={learnhouseIcon}
                            alt="LearnHouse"
                            className="object-contain"
                          />
                        )
                      }
                    />
                  </div>
                )}
                <span
                  aria-hidden
                  className={cn("text-2xl font-light leading-none", text_color === 'light' ? "text-white/60" : "text-gray-400")}
                >
                  ×
                </span>
                <span className="text-2xl font-semibold leading-none tracking-tight">Akademi</span>
              </Link>
            </>
          )}

          {/* Unsplash attribution (required by Unsplash API guidelines) */}
          {background_type === 'unsplash' && background_image && unsplash_photographer_name && (
            <div className={cn(
              "absolute bottom-3 start-4 end-4 z-10 text-[11px] leading-tight",
              text_color === 'light' ? "text-white/70" : "text-gray-700"
            )}>
              <Trans
                i18nKey="auth.photo_credit"
                values={{ name: unsplash_photographer_name }}
                components={{
                  photographer: (
                    <a
                      href={withUtm(unsplash_photographer_url) || withUtm(unsplash_photo_url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:opacity-100 opacity-90"
                    />
                  ),
                  unsplash: (
                    <a
                      href={`https://unsplash.com/${UNSPLASH_UTM}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:opacity-100 opacity-90"
                    />
                  ),
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
