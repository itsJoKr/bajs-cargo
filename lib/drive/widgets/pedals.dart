import 'package:flutter/material.dart';

/// Brake and gas pedals for the right thumb. Each is held (1) or released
/// (0); sliding a held thumb from one pedal onto the other does not switch,
/// so a panic brake never becomes gas.
class Pedals extends StatelessWidget {
  const Pedals({super.key, required this.onGas, required this.onBrake});

  final ValueChanged<double> onGas, onBrake;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        _Pedal(
          key: const ValueKey('pedal_brake'),
          label: 'BRAKE',
          size: const Size(84, 96),
          color: const Color(0xFFE0674F),
          onChanged: onBrake,
        ),
        const SizedBox(width: 14),
        _Pedal(
          key: const ValueKey('pedal_gas'),
          label: 'GAS',
          size: const Size(92, 132),
          color: const Color(0xFF6FC27A),
          onChanged: onGas,
        ),
      ],
    );
  }
}

class _Pedal extends StatefulWidget {
  const _Pedal({
    super.key,
    required this.label,
    required this.size,
    required this.color,
    required this.onChanged,
  });

  final String label;
  final Size size;
  final Color color;
  final ValueChanged<double> onChanged;

  @override
  State<_Pedal> createState() => _PedalState();
}

class _PedalState extends State<_Pedal> {
  int? _pointer;

  void _down(PointerDownEvent event) {
    if (_pointer != null) return;
    setState(() => _pointer = event.pointer);
    widget.onChanged(1);
  }

  void _up(PointerEvent event) {
    if (event.pointer != _pointer) return;
    setState(() => _pointer = null);
    widget.onChanged(0);
  }

  @override
  Widget build(BuildContext context) {
    final held = _pointer != null;
    return Semantics(
      label: widget.label,
      button: true,
      child: Listener(
        behavior: HitTestBehavior.opaque,
        onPointerDown: _down,
        onPointerUp: _up,
        onPointerCancel: _up,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 60),
          width: widget.size.width,
          height: widget.size.height,
          decoration: BoxDecoration(
            color: widget.color.withValues(alpha: held ? .85 : .35),
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: const Color(0xCCF0F2F4), width: 2),
          ),
          alignment: Alignment.center,
          child: Text(
            widget.label,
            style: const TextStyle(
              color: Color(0xFFF4F6F8),
              fontWeight: FontWeight.w900,
              letterSpacing: 1.5,
            ),
          ),
        ),
      ),
    );
  }
}
