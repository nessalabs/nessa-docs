# Third-party source

`vendor/nessa-ui/` contains the MIT-licensed Nessa UI primitives used by this app, from https://github.com/nessalabs/nessa_ui at commit `b0cb660d1e729cb6958181a9f8c011fcf0a759ef`. The upstream license is retained in `vendor/nessa-ui/LICENSE`.

The subset contains badge, button, input, status label, segmented control, settings group and tabs; their four local helpers; and the shared styles and theme. Source import aliases are made relative, and the unused composites CSS source scan is removed. No upstream assets or icon inventory are included.

Other third-party dependencies are installed by npm and retain their licenses in their packages.
