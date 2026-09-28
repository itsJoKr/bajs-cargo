import 'package:flutter/material.dart';

/// A fixed on-screen thumbstick. Only its horizontal deflection steers.
class SteeringStick extends StatefulWidget {
  const SteeringStick({super.key, required this.onSteer});

  /// Receives steering from -1 (full left) to 1 (full right); 0 on release.
  final ValueChanged<double> onSteer;

  static const radius = 62.0;

  @override
  State<SteeringStick> createState() => _SteeringStickState();
}

class _SteeringStickState extends State<SteeringStick> {
  // Full lock comes before the rim so a thumb does not have to hit the edge.
  static const _deadZone = 6.0, _fullLock = SteeringStick.radius * .8;
  static const _area = Size(220, 156);
  int? _pointer;
  Offset _knob = Offset.zero;

  void _move(Offset local) {
    var knob = local - _area.center(Offset.zero);
    if (knob.distance > SteeringStick.radius) {
      knob = knob / knob.distance * SteeringStick.radius;
    }
    final amount = ((knob.dx.abs() - _deadZone) / (_fullLock - _deadZone))
        .clamp(0.0, 1.0);
    setState(() => _knob = knob);
    widget.onSteer(knob.dx.sign * amount);
  }

  void _release(PointerEvent event) {
    if (event.pointer != _pointer) return;
    _pointer = null;
    setState(() => _knob = Offset.zero);
    widget.onSteer(0);
  }

  @override
  Widget build(BuildContext context) {
    const knobSize = 54.0, baseSize = SteeringStick.radius * 2;
    final held = _pointer != null;
    return Semantics(
      label: 'Steering stick',
      child: Listener(
        key: const ValueKey('steering_stick'),
        behavior: HitTestBehavior.opaque,
        onPointerDown: (event) {
          if (_pointer != null) return;
          _pointer = event.pointer;
          _move(event.localPosition);
        },
        onPointerMove: (event) {
          if (event.pointer == _pointer) _move(event.localPosition);
        },
        onPointerUp: _release,
        onPointerCancel: _release,
        child: SizedBox.fromSize(
          size: _area,
          child: Stack(
            alignment: Alignment.center,
            children: [
              Container(
                width: baseSize,
                height: baseSize,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: const Color(0x33102536),
                  border: Border.all(color: const Color(0x99F0F2F4), width: 2),
                ),
                child: const Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Icon(Icons.chevron_left_rounded, color: Color(0xB3F0F2F4)),
                    Icon(Icons.chevron_right_rounded, color: Color(0xB3F0F2F4)),
                  ],
                ),
              ),
              Transform.translate(
                offset: _knob,
                child: Container(
                  width: knobSize,
                  height: knobSize,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: held
                        ? const Color(0xFFFFD35A)
                        : const Color(0xE6F0F2F4),
                    border: Border.all(color: const Color(0xFF688395)),
                    boxShadow: const [
                      BoxShadow(color: Color(0x40000000), blurRadius: 6),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
